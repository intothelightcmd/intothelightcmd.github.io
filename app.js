(() => {
  "use strict";

  const DB_NAME = "dongpae-rescue-archive";
  const DB_VERSION = 1;
  const state = { view: "panels", panels: [], chats: [], search: "", source: "all", status: "all", sort: "newest", detailType: null, detailId: null, detailChatView: "original", extracted: [] };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const grid = $("#grid");
  const editor = $("#editorDialog");
  const detail = $("#detailDialog");
  const form = $("#recordForm");
  let dbPromise;
  let previewTimer;
  let toastTimer;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["panels", "chats"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function getAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(store, record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readwrite").objectStore(store).put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    });
  }

  async function remove(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readwrite").objectStore(store).delete(id);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  const storeFor = type => type === "panel" ? "panels" : "chats";
  const recordsFor = type => type === "panel" ? state.panels : state.chats;
  const statusName = value => ({ chosen: "채택", unchosen: "미채택", undecided: "미정" })[value] || "미정";
  const sourceName = value => ({ simulation: "시뮬", rp: "RP" })[value] || "";
  const byId = (type, id) => recordsFor(type).find(record => record.id === id);

  function panelDoc(code = "") {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src https: data:;"><style>html,body{min-height:100%;margin:0;background:#101310;color:#d8ded9}body{padding:12px;overflow:auto}img{max-width:100%}</style></head><body>${code}</body></html>`;
  }

  function formatDate(value) {
    return value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
  }

  function autoTitle(type, output) {
    const date = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return `${date}${output === "" ? "" : ` #${output}`} ${type === "panel" ? "동패" : "채팅"}`;
  }

  function excerpt(value = "") {
    return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
  }

  function searchText(record) {
    return [record.title, record.sourceType, sourceName(record.sourceType), record.status, statusName(record.status), record.world, record.character, record.outputNumber, record.rerollNumber, record.artifactType, (record.tags || []).join(" "), record.memo, record.context, record.code, record.content, record.outputMode, record.translation].filter(Boolean).join(" ").toLowerCase();
  }

  function visibleRecords() {
    const query = state.search.trim().toLowerCase().replace(/^#/, "");
    const records = state.view === "panels" ? state.panels : state.chats;
    return records.filter(record => {
      if (state.source !== "all" && record.sourceType !== state.source) return false;
      if (state.status !== "all" && record.status !== state.status) return false;
      return !query || searchText(record).includes(query);
    }).sort((a, b) => {
      if (state.sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
      if (state.sort === "output_desc") return (Number(b.outputNumber) || -1) - (Number(a.outputNumber) || -1) || new Date(b.createdAt) - new Date(a.createdAt);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function badgeMarkup(record) {
    const items = [];
    if (record.sourceType) items.push(`<span class="badge ${record.sourceType}">${sourceName(record.sourceType)}</span>`);
    items.push(`<span class="badge ${record.status || "undecided"}">${statusName(record.status)}</span>`);
    if (record.rerollNumber) items.push(`<span class="badge">리롤 ${esc(record.rerollNumber)}</span>`);
    if (record.type === "panel" && record.artifactType) items.push(`<span class="badge">${esc(record.artifactType)}</span>`);
    if (record.type === "chat" && record.outputMode) items.push(`<span class="badge">${record.outputMode === "en" ? "영입영출" : "한입한출"}</span>`);
    if (record.type === "chat" && record.outputMode === "en" && record.translation) items.push(`<span class="badge chosen">번역 있음</span>`);
    return items.join("");
  }

  function makeCard(record) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = record.id;
    card.dataset.type = record.type;
    const output = record.outputNumber === null || record.outputNumber === undefined ? "" : `#${esc(record.outputNumber)}`;
    const meta = [record.world, record.character, ...(record.tags || []).slice(0, 2)].filter(Boolean).join(" · ") || formatDate(record.createdAt);
    const preview = record.type === "panel" ? `<div class="panel-preview"><iframe sandbox="" referrerpolicy="no-referrer" title="동패 미리보기"></iframe></div>` : `<div class="chat-preview">${esc(excerpt(record.content).slice(0, 700) || "저장된 채팅 원문")}</div>`;
    card.innerHTML = `${preview}<div class="card-body"><div class="card-head"><h2 title="${esc(record.title)}">${esc(record.title)}</h2><span class="num">${output}</span></div><div class="badges">${badgeMarkup(record)}</div><p class="meta">${esc(meta)}</p><div class="card-actions"><button class="btn small" data-action="view" type="button">열어보기</button><button class="btn small" data-action="copy" type="button">복사</button><button class="btn small icon" data-action="edit" type="button" aria-label="수정">✎</button></div></div>`;
    if (record.type === "panel") $("iframe", card).srcdoc = panelDoc(record.code);
    return card;
  }

  function render() {
    const records = visibleRecords();
    grid.replaceChildren();
    if (!records.length) {
      const filtered = state.search || state.source !== "all" || state.status !== "all";
      const empty = document.createElement("section");
      empty.className = "empty";
      empty.innerHTML = `<div><div class="symbol">${state.view === "panels" ? "▧" : "☷"}</div><h2>${filtered ? "찾은 기록이 엄써!" : state.view === "panels" ? "첫 동패를 구조해보자!" : "사라질 리롤 채팅을 구조해보자!"}</h2><p>${filtered ? "검색어나 필터를 바꾸면 숨어 있던 기록이 나올지도 몰라요." : state.view === "panels" ? "실리에서 나온 동패 소스를 붙여넣으면 움직이는 모습과 원본 코드가 함께 보존됩니다." : "채택하지 않은 응답을 통째로 붙여넣고 #아웃풋과 리롤 번호를 기록해둘 수 있습니다."}</p><button class="btn primary" data-empty-add type="button">${state.view === "panels" ? "동패 구조하기" : "채팅 구조하기"}</button></div>`;
      grid.append(empty);
    } else records.forEach(record => grid.append(makeCard(record)));
    $("#panelCount").textContent = state.panels.length;
    $("#chatCount").textContent = state.chats.length;
  }

  async function refresh() {
    [state.panels, state.chats] = await Promise.all([getAll("panels"), getAll("chats")]);
    render();
  }

  function switchView(view) {
    state.view = view;
    $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));
    $("#addText").textContent = view === "panels" ? "동패 구조하기" : "채팅 구조하기";
    render();
  }

  function setEditorType(type) {
    $("#recordType").value = type;
    $$(".panel-only").forEach(el => el.classList.toggle("hidden", type !== "panel"));
    $$(".chat-only").forEach(el => el.classList.toggle("hidden", type !== "chat"));
    updateTranslationField();
  }

  function updateTranslationField() {
    const show = $("#recordType").value === "chat" && $("#outputModeInput").value === "en";
    $("#translationField").classList.toggle("hidden", !show);
  }

  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const code = $("#codeInput").value.trim();
      $("#livePreview").srcdoc = panelDoc(code || `<div style="min-height:440px;display:grid;place-items:center;color:#6e786f;font:13px system-ui;text-align:center">동패 코드를 붙여넣으면<br>여기에 바로 나타나요.</div>`);
      $("#previewState").textContent = code ? "움직이는 미리보기" : "코드를 붙여넣어 주세요";
    }, 100);
  }

  function openEditor(type, record = null, preset = null) {
    form.reset();
    $("#recordId").value = record?.id || "";
    $("#linkedChatId").value = record?.linkedChatId || preset?.linkedChatId || "";
    $("#editorDelete").classList.toggle("hidden", !record);
    setEditorType(type);
    const data = record || preset;
    if (data) {
      $("#titleInput").value = data.title || "";
      $("#sourceInput").value = data.sourceType || "";
      $("#statusInput").value = data.status || "undecided";
      $("#worldInput").value = data.world || "";
      $("#characterInput").value = data.character || "";
      $("#outputInput").value = data.outputNumber ?? "";
      $("#rerollInput").value = data.rerollNumber ?? "";
      $("#artifactInput").value = data.artifactType || "";
      $("#tagsInput").value = (data.tags || []).join(", ");
      $("#memoInput").value = data.memo || "";
      $("#contextInput").value = data.context || "";
      $("#codeInput").value = data.code || "";
      $("#contentInput").value = data.content || "";
      $("#outputModeInput").value = data.outputMode || "ko";
      $("#translationInput").value = data.translation || "";
    }
    updateTranslationField();
    $("#editorTitle").textContent = record ? `${type === "panel" ? "동패" : "채팅"} 기록 수정하기` : `새 ${type === "panel" ? "동패" : "채팅"} 구조하기`;
    updatePreview();
    editor.showModal();
    setTimeout(() => $("#titleInput").focus(), 30);
  }

  function recordFromForm() {
    const type = $("#recordType").value;
    const old = byId(type, $("#recordId").value);
    const output = $("#outputInput").value;
    const reroll = $("#rerollInput").value;
    return {
      id: old?.id || uid(), type,
      title: $("#titleInput").value.trim() || autoTitle(type, output),
      sourceType: $("#sourceInput").value,
      status: $("#statusInput").value || "undecided",
      world: $("#worldInput").value.trim(), character: $("#characterInput").value.trim(),
      outputNumber: output === "" ? null : Number(output), rerollNumber: reroll === "" ? null : Number(reroll),
      artifactType: type === "panel" ? $("#artifactInput").value.trim() : "",
      tags: type === "panel" ? $("#tagsInput").value.split(",").map(item => item.trim()).filter(Boolean) : [],
      memo: $("#memoInput").value.trim(), context: type === "chat" ? $("#contextInput").value.trim() : "",
      code: type === "panel" ? $("#codeInput").value.trim() : "", content: type === "chat" ? $("#contentInput").value.trim() : "",
      outputMode: type === "chat" ? $("#outputModeInput").value : "",
      translation: type === "chat" && $("#outputModeInput").value === "en" ? $("#translationInput").value.trim() : "",
      linkedChatId: type === "panel" ? $("#linkedChatId").value || null : null,
      createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }

  async function saveRecord(event) {
    event.preventDefault();
    const record = recordFromForm();
    if (record.type === "panel" && !record.code) return showToast("동패 소스코드를 붙여넣어 줘!");
    if (record.type === "chat" && !record.content) return showToast("채팅 아웃풋 원문을 붙여넣어 줘!");
    await put(storeFor(record.type), record);
    editor.close();
    await refresh();
    showToast(record.type === "panel" ? "동패를 구조해씀!" : "채팅을 구조해씀!");
  }

  function markdown(text = "") {
    let safe = esc(text).replace(/\r\n?/g, "\n");
    safe = safe.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="source-code"><code>${code.trim()}</code></pre>`)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>");
    return safe.split(/\n{2,}/).map(block => {
      const value = block.trim();
      if (!value) return "";
      if (value.startsWith("&gt;")) return `<blockquote>${value.replace(/^&gt;\s?/gm, "").replace(/\n/g, "<br>")}</blockquote>`;
      if (value.startsWith("<pre")) return value;
      return `<p>${value.replace(/\n/g, "<br>")}</p>`;
    }).join("");
  }

  function splitPanels(text = "") {
    const segments = [];
    const tags = /<\/?div\b[^>]*>/gi;
    let cursor = 0;
    while (cursor < text.length) {
      tags.lastIndex = cursor;
      const first = tags.exec(text);
      if (!first || /^<\/div/i.test(first[0])) { segments.push({ type: "text", value: text.slice(cursor) }); break; }
      if (first.index > cursor) segments.push({ type: "text", value: text.slice(cursor, first.index) });
      let depth = 1;
      let end = tags.lastIndex;
      while (depth > 0) {
        const next = tags.exec(text);
        if (!next) { end = text.length; break; }
        depth += /^<\/div/i.test(next[0]) ? -1 : 1;
        end = tags.lastIndex;
      }
      segments.push({ type: "panel", value: text.slice(first.index, end) });
      cursor = end;
    }
    return segments.filter(segment => segment.value.trim());
  }

  function metaMarkup(record) {
    const rows = [["출처", sourceName(record.sourceType) || "미지정"], ["채택 상태", statusName(record.status)], ["아웃풋", record.outputNumber === null || record.outputNumber === undefined ? "미지정" : `#${record.outputNumber}`], ["리롤", record.rerollNumber ? `${record.rerollNumber}번째` : "미지정"], ["세계관", record.world || "미지정"], ["캐릭터", record.character || "미지정"]];
    if (record.type === "panel") rows.push(["동패 종류", record.artifactType || "미지정"], ["태그", (record.tags || []).join(", ") || "없음"]);
    if (record.type === "chat" && record.outputMode) rows.push(["출력 방식", record.outputMode === "en" ? "영입영출" : "한입한출"]);
    rows.push(["저장일", formatDate(record.createdAt)], ["장면 메모", record.memo || "없음"]);
    return `<dl class="meta-list">${rows.map(([key, value]) => `<div class="meta-row"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
  }

  function renderPanelDetail(record) {
    const linked = record.linkedChatId ? byId("chat", record.linkedChatId) : null;
    $("#detailContent").innerHTML = `<div class="detail"><div><iframe class="detail-frame" id="bigPanel" sandbox="" referrerpolicy="no-referrer"></iframe><details class="source"><summary>원본 소스코드 보기</summary><pre class="source-code">${esc(record.code)}</pre></details></div><aside class="side"><div class="box"><h3>기록 정보</h3>${metaMarkup(record)}</div>${linked ? `<div class="box"><h3>연결된 채팅</h3><button class="btn small" data-open-chat="${esc(linked.id)}" type="button">${esc(linked.title)}</button></div>` : ""}</aside></div>`;
    $("#bigPanel").srcdoc = panelDoc(record.code);
    $("#detailCopy").textContent = "원본 복사";
    $("#detailCopy").disabled = false;
  }

  function renderChatDetail(record) {
    const segments = splitPanels(record.content);
    state.extracted = segments.filter(item => item.type === "panel").map(item => item.value);
    let index = 0;
    const body = segments.map(segment => segment.type === "text" ? `<div class="chat-text">${markdown(segment.value)}</div>` : `<div class="embedded"><iframe data-embedded="${index}" sandbox="" referrerpolicy="no-referrer"></iframe><button class="btn small primary rescue" data-rescue="${index++}" type="button">동패 저장함으로 구조</button></div>`).join("");
    const related = state.chats.filter(item => item.id !== record.id && record.outputNumber !== null && item.outputNumber === record.outputNumber);
    const linked = state.panels.filter(item => item.linkedChatId === record.id);
    const english = record.outputMode === "en";
    const tabs = english ? `<div class="chat-tabs"><button class="chat-tab active" data-chat-pane-button="original" type="button">영문 원문</button><button class="chat-tab" data-chat-pane-button="translation" type="button">한글 번역</button></div>` : "";
    const original = `<div class="reader" data-chat-pane="original">${record.context ? `<div class="context-box"><strong>직전 입력·상황</strong><br>${esc(record.context)}</div>` : ""}${body || `<div class="chat-text"><p>${esc(record.content)}</p></div>`}<details class="source"><summary>채팅 원문 그대로 보기</summary><pre class="source-code">${esc(record.content)}</pre></details></div>`;
    const translation = english ? `<div data-chat-pane="translation" class="hidden">${record.translation ? `<div class="reader"><div class="chat-text">${markdown(record.translation)}</div><details class="source"><summary>번역본 그대로 보기</summary><pre class="source-code">${esc(record.translation)}</pre></details></div>` : `<div class="translation-empty"><div><h3>저장된 번역본이 엄써!</h3><p>나중에 번역 확장에서 가져온 번역본을 붙여넣으면 여기에 보관됩니다.</p><button class="btn primary" data-add-translation type="button">번역본 추가하기</button></div></div>`}</div>` : "";
    $("#detailContent").innerHTML = `<div class="detail"><div>${tabs}${original}${translation}</div><aside class="side"><div class="box"><h3>기록 정보</h3>${metaMarkup(record)}</div>${related.length ? `<div class="box"><h3>같은 #${esc(record.outputNumber)} 리롤</h3><div class="row">${related.map(item => `<button class="btn small" data-open-chat="${esc(item.id)}" type="button">리롤 ${esc(item.rerollNumber || "?")}</button>`).join("")}</div></div>` : ""}${linked.length ? `<div class="box"><h3>구조한 동패</h3><div class="row">${linked.map(item => `<button class="btn small" data-open-panel="${esc(item.id)}" type="button">${esc(item.title)}</button>`).join("")}</div></div>` : ""}</aside></div>`;
    $$('[data-embedded]', $("#detailContent")).forEach(frame => { frame.srcdoc = panelDoc(state.extracted[Number(frame.dataset.embedded)] || ""); });
    if (english) switchChatPane("original");
    else { state.detailChatView = "original"; $("#detailCopy").textContent = "원본 복사"; $("#detailCopy").disabled = false; }
  }

  function switchChatPane(view) {
    const record = byId("chat", state.detailId);
    if (!record || record.outputMode !== "en") return;
    state.detailChatView = view;
    $$('[data-chat-pane-button]', $("#detailContent")).forEach(button => button.classList.toggle("active", button.dataset.chatPaneButton === view));
    $$('[data-chat-pane]', $("#detailContent")).forEach(pane => pane.classList.toggle("hidden", pane.dataset.chatPane !== view));
    $("#detailCopy").textContent = view === "translation" ? "번역본 복사" : "영문 원문 복사";
    $("#detailCopy").disabled = view === "translation" && !record.translation;
  }

  function openDetail(type, id) {
    const record = byId(type, id);
    if (!record) return;
    state.detailType = type;
    state.detailId = id;
    state.detailChatView = "original";
    $("#detailTitle").textContent = record.title;
    type === "panel" ? renderPanelDetail(record) : renderChatDetail(record);
    if (!detail.open) detail.showModal();
    $("#detailContent").scrollTop = 0;
  }

  function rescuePanel(index) {
    const chat = byId("chat", state.detailId);
    const code = state.extracted[index];
    if (!chat || !code) return;
    detail.close();
    openEditor("panel", null, { title: `${chat.title} 속 동패`, sourceType: chat.sourceType, status: chat.status, world: chat.world, character: chat.character, outputNumber: chat.outputNumber, rerollNumber: chat.rerollNumber, memo: chat.memo, code, linkedChatId: chat.id });
  }

  async function copy(value, message = "원본을 복사해씀!") {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const area = document.createElement("textarea"); area.value = value; document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    showToast(message);
  }

  async function deleteRecord(type, id) {
    const record = byId(type, id);
    if (!record || !confirm(`「${record.title}」 기록을 삭제할까?\n전체 백업이 없다면 되돌릴 수 엄써!`)) return;
    await remove(storeFor(type), id);
    if (type === "chat") {
      for (const panel of state.panels.filter(item => item.linkedChatId === id)) await put("panels", { ...panel, linkedChatId: null, updatedAt: new Date().toISOString() });
    }
    editor.close(); detail.close();
    await refresh();
    showToast("기록을 삭제해씀.");
  }

  function showToast(message) {
    const el = $("#toast");
    el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function updateThemeButton() {
    const light = document.documentElement.dataset.theme === "light";
    const button = $("#themeBtn");
    button.innerHTML = `${light ? "☾" : "☀"} <span>${light ? "어둡게" : "밝게"}</span>`;
    button.title = light ? "어두운 테마로 바꾸기" : "밝은 테마로 바꾸기";
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dongpae-theme", next); } catch {}
    updateThemeButton();
    showToast(next === "light" ? "눈 편한 밝은 기록실로 바까씀!" : "깜까미 구조소로 도라와씀!");
  }

  function exportData() {
    const payload = { format: "dongpae-rescue-archive", version: 1, exportedAt: new Date().toISOString(), panels: state.panels, chats: state.chats };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `dongpae-archive-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast("전체 보관함을 백업해씀!");
  }

  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== "dongpae-rescue-archive" || !Array.isArray(data.panels) || !Array.isArray(data.chats)) throw new Error("invalid");
      if (!confirm(`동패 ${data.panels.length}개와 채팅 ${data.chats.length}개를 현재 보관함에 합칠까?\n같은 기록은 백업본으로 갱신됩니다.`)) return;
      for (const item of data.panels) await put("panels", { ...item, type: "panel" });
      for (const item of data.chats) await put("chats", { ...item, type: "chat" });
      await refresh(); showToast("백업을 무사히 불러와씀!");
    } catch { showToast("이고는 리롤 구조소 백업 파일이 아닌 것 가타!"); }
    finally { $("#importFile").value = ""; }
  }

  $$(".tab").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("#addBtn").addEventListener("click", () => openEditor(state.view === "panels" ? "panel" : "chat"));
  $("#searchInput").addEventListener("input", event => { state.search = event.target.value; render(); });
  $("#sourceFilter").addEventListener("change", event => { state.source = event.target.value; render(); });
  $("#statusFilter").addEventListener("change", event => { state.status = event.target.value; render(); });
  $("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; render(); });
  $("#codeInput").addEventListener("input", updatePreview);
  $("#outputModeInput").addEventListener("change", updateTranslationField);
  form.addEventListener("submit", saveRecord);

  grid.addEventListener("click", event => {
    if (event.target.closest("[data-empty-add]")) return openEditor(state.view === "panels" ? "panel" : "chat");
    const action = event.target.closest("[data-action]");
    const card = event.target.closest(".card");
    if (!action || !card) return;
    const record = byId(card.dataset.type, card.dataset.id);
    if (!record) return;
    if (action.dataset.action === "view") openDetail(record.type, record.id);
    if (action.dataset.action === "edit") openEditor(record.type, record);
    if (action.dataset.action === "copy") copy(record.type === "panel" ? record.code : record.content);
  });

  document.addEventListener("click", event => {
    const close = event.target.closest("[data-close]");
    if (close) $("#" + close.dataset.close).close();
    const rescue = event.target.closest("[data-rescue]");
    if (rescue) rescuePanel(Number(rescue.dataset.rescue));
    const chat = event.target.closest("[data-open-chat]");
    if (chat) openDetail("chat", chat.dataset.openChat);
    const panel = event.target.closest("[data-open-panel]");
    if (panel) openDetail("panel", panel.dataset.openPanel);
    const pane = event.target.closest("[data-chat-pane-button]");
    if (pane) switchChatPane(pane.dataset.chatPaneButton);
    const addTranslation = event.target.closest("[data-add-translation]");
    if (addTranslation) {
      const record = byId("chat", state.detailId);
      if (record) {
        detail.close();
        openEditor("chat", record);
        setTimeout(() => $("#translationInput").focus(), 50);
      }
    }
  });

  $("#detailCopy").addEventListener("click", () => {
    const record = byId(state.detailType, state.detailId);
    if (!record) return;
    const value = record.type === "panel" ? record.code : state.detailChatView === "translation" ? record.translation : record.content;
    if (value) copy(value, state.detailChatView === "translation" ? "번역본을 복사해씀!" : "원본을 복사해씀!");
  });
  $("#detailEdit").addEventListener("click", () => { const record = byId(state.detailType, state.detailId); if (record) { detail.close(); openEditor(record.type, record); } });
  $("#detailDelete").addEventListener("click", () => deleteRecord(state.detailType, state.detailId));
  $("#editorDelete").addEventListener("click", () => deleteRecord($("#recordType").value, $("#recordId").value));
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#exportBtn").addEventListener("click", exportData);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", event => event.target.files[0] && importData(event.target.files[0]));

  [editor, detail].forEach(dialog => dialog.addEventListener("click", event => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));

  refresh().catch(error => {
    console.error(error);
    grid.innerHTML = `<section class="empty"><div><div class="symbol">!</div><h2>보관함을 열지 못해씀!</h2><p>브라우저에서 사이트 데이터 저장이 차단되어 있는지 확인해 주세요.</p></div></section>`;
  });
  updateThemeButton();
  updatePreview();
})();
