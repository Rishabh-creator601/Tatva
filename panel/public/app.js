// Tatva Panel — frontend logic (vanilla JS)
let db = { settings: { theme: "dark" }, categories: [], items: [] };
let current = null;     // current category id
let editingId = null;   // item id being edited (or null = new)
let igniteProjects = [];  // Project manager: projects fetched live from the Ignite panel (localhost:1234), cached for nav count

const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function load() {
  const r = await fetch("/api/db");
  db = await r.json();
  if (!db.settings) db.settings = { theme: "dark" };
  // migrate legacy importantSubjects[] -> per-carousel meta
  if (Array.isArray(db.settings.importantSubjects)) {
    db.settings.importantSubjects.forEach((s) => { ensureCar("subjects", s).important = true; });
    delete db.settings.importantSubjects;
  }
  applyTheme(db.settings.theme || "dark");
  if (!current || !db.categories.find((c) => c.id === current))
    current = db.categories[0] ? db.categories[0].id : null;
  render();
}

let saveTimer = null, dirty = false;
async function save(immediate) {
  dirty = true;
  clearTimeout(saveTimer);
  const doSave = async () => {
    if (!dirty) return;
    dirty = false;
    try {
      const r = await fetch("/api/db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(db) });
      const j = await r.json();
      if (j.ok) { toast("Saved ✓ (backup made)"); maybeAutoSyncDrive(); } else toast("Save error");
    } catch (e) { toast("Save failed — is the server running?"); }
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 350);
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1600);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("#themeBtn").textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
}
$("#themeBtn").onclick = () => {
  const t = (db.settings.theme === "dark") ? "light" : "dark";
  db.settings.theme = t; applyTheme(t); save();
};

/* ---------- render ---------- */
function cat(id) { return db.categories.find((c) => c.id === id); }
function itemsOf(id) { return db.items.filter((i) => i.category === id); }

/* ----- standard pages (carousel-based; see .claude/pages.md) -----
   standard = carousel page · exportable · importable (images/text, even by folder)
            · can't be renamed or deleted from the UI.
   instant  = gets an "Instant" carousel for quick dumps, movable to a real carousel. */
const PAGES = {
  subjects:    { standard: true, instant: true },
  astrology:   { standard: true, instant: true, catLinks: true },
  shortnotes:  { standard: true, instant: false },
  personality: { standard: true, instant: true },
  programming: { standard: true, instant: true, catLinks: true },
  college:     { standard: true, instant: true, catLinks: true },
};
function pageCfg(id) { return PAGES[id] || {}; }
function isStandard(id) { return !!pageCfg(id).standard; }
function isInstantPage(id) { return !!pageCfg(id).instant; }
// links carousel name (see .claude/pages.md): cat-Links pages let the user name a links category →
// "LINKS - {Category}"; plain pages drop everything into a single "LINKS".
function linkSection(id, category) {
  if (!pageCfg(id).catLinks) return "LINKS";
  const c = (category || "").trim() || "General";
  return "LINKS - " + c;
}
function isLinkSection(s) { return s === "LINKS" || /^LINKS - /.test(s); }
// existing "LINKS - X" categories already used on a cat-Links page (for the datalist)
function linkCategories(id) {
  return [...new Set(itemsOf(id).map((i) => i.section || "").filter((s) => /^LINKS - /.test(s)).map((s) => s.slice(8)))];
}
function pageDefaultSection(id) { return isInstantPage(id) ? "Instant" : (id === "astrology" ? "Quick" : "General"); }

function buildNav() {
  const nav = $("#nav");
  // "instant" is no longer a sidebar menu — its items are reached via the Quick items side button.
  nav.innerHTML = db.categories.filter((c) => c.id !== "instant").map((c) => {
    const n = c.id === "subjects"
      ? new Set(itemsOf("subjects").map((i) => i.section || "Instant")).size
      : c.id === "projects" ? igniteProjects.length
      : itemsOf(c.id).length;
    const ct = (c.id === "home" || (c.id === "projects" && !n)) ? "" : `<span class="ct">${n}</span>`;
    return `<button class="navbtn ${c.id === current ? "on" : ""}" data-id="${c.id}" style="--dc:${c.color}">
       <span class="ico">${c.icon || "📌"}</span>${esc(c.label)}${ct}</button>`;
  }).join("");
  nav.querySelectorAll(".navbtn").forEach((b) => b.onclick = () => { current = b.dataset.id; render(); });
  // Quick items side button: shows count, opens the quick-add inbox (instant store)
  const qv = $("#quickView");
  if (qv) { qv.classList.toggle("on", current === "instant"); $("#quickCt").textContent = itemsOf("instant").length; }
}

function render() {
  buildNav();
  stopHomeTimers();
  const c = cat(current);
  if (!c) { $("#catTitle").textContent = "No menus yet"; $("#content").innerHTML = ""; return; }
  $("#catTitle").innerHTML = `${c.icon || "📌"} ${esc(c.label)}`;
  $("#catSub").textContent = c.desc || "Local DB · auto-saved with backup · pick any menu on the left to jump across";
  $("#catPill").style.background = c.color + "22"; $("#catPill").style.color = c.color;
  setBarVisibility();
  document.querySelector(".main").classList.toggle("homewide", current === "home");  // home spans full width so the widget card sits at the screen's right edge

  if (current === "home") { $("#catPill").textContent = "live"; renderHome(c); return; }
  $("#catPill").textContent = itemsOf(current).length + " entries";
  if (current === "subjects") { renderSubjects(c); return; }
  if (current === "projects") { renderProjects(c); return; }
  if (isStandard(current)) { renderStandard(c); return; }

  const q = ($("#search").value || "").toLowerCase();
  let items = itemsOf(current);
  if (q) items = items.filter((i) => (i.title + " " + i.body + " " + (i.section || "")).toLowerCase().includes(q));

  const buildSections = (list) => {
    const secs = [];
    for (const i of list) { const s = i.section || "General"; if (!secs.includes(s)) secs.push(s); }
    return secs.map((s) => {
      const cards = list.filter((i) => (i.section || "General") === s).map((i) => cardHTML(i, c)).join("");
      return `<div class="sechead"><span>${esc(s)}</span><span class="line"></span></div><div class="grid">${cards}</div>`;
    }).join("");
  };

  if (!items.length) {
    $("#content").innerHTML = `<div class="empty">No entries${q ? " match your search" : " yet"}.</div>`;
  } else if (current === "todo") {
    const missed = items.filter(isMissed), active = items.filter((i) => !isMissed(i));
    const imp = active.filter((i) => i.important), rest = active.filter((i) => !i.important);
    let html = "";
    if (imp.length) html += `<div class="sechead"><span>⭐ Important</span><span class="line"></span></div><div class="grid">${imp.map((i) => cardHTML(i, c)).join("")}</div>`;
    html += buildSections(rest);
    if (missed.length) html += `<div class="sechead missedhead"><span>⏰ Missed</span><span class="line"></span></div><div class="grid">${missed.map((i) => cardHTML(i, c)).join("")}</div>`;
    $("#content").innerHTML = html;
  } else {
    $("#content").innerHTML = buildSections(items);
  }
  attachContentHandlers();
}

function setBarVisibility() {
  const isHome = current === "home", isTodo = current === "todo", isSubj = current === "subjects", isProj = current === "projects", std = isStandard(current);
  $("#addItem").style.display = (isHome || isTodo || isSubj || isProj) ? "none" : "";   // subjects is image-only; projects are live from Ignite
  $("#addGoals").style.display = isTodo ? "" : "none";
  $("#addImage").style.display = std ? "" : "none";                           // standard pages import images/text
  $("#addLink").style.display = std ? "" : "none";                            // standard pages: links go to a "LINKS" carousel
  $("#exportCat").style.display = (isHome || isProj) ? "none" : "";           // projects live elsewhere — nothing local to export
  const lockPage = isHome || std || isProj || current === "instant";          // standard pages + quick inbox + projects can't be renamed/deleted
  $("#renCat").style.display = lockPage ? "none" : "";
  $("#delCat").style.display = lockPage ? "none" : "";
  $("#search").style.display = isHome ? "none" : "";
}

// Generic standard page: every section is a carousel; items may be images, text files, or notes.
function renderStandard(c) {
  const cid = c.id, dflt = pageDefaultSection(cid);
  let items = itemsOf(cid);
  const q = ($("#search").value || "").toLowerCase();
  // search covers: item title/body (text-file content), special message, link, the section (carousel title)
  // and the whole-carousel header message.
  if (q) items = items.filter((i) => {
    const hay = [i.title, i.body, i.section, i.link, i.message, carMsg(cid, i.section || dflt)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
  if (!items.length) { $("#content").innerHTML = `<div class="empty">No entries${q ? " match your search" : " yet"}.</div>`; return; }
  const sections = sortedSections(cid, [...new Set(items.map((i) => i.section || dflt))]);
  const total = sections.length;
  $("#content").innerHTML = sections.map((s, idx) => {
    const list = items.filter((i) => (i.section || dflt) === s);
    const isInstant = isInstantPage(cid) && s === "Instant", imp = carImp(cid, s);
    const accent = carAccent(cid, s, isInstant ? "#ffd166" : c.color);
    return `<div class="subject ${isInstant ? "instant" : ""} ${imp ? "impcar" : ""}" style="--dc:${accent}">
      ${carHeader(cid, s, idx + 1, total, list.length)}${imgCarousel(list, accent)}</div>`;
  }).join("");
  attachContentHandlers();
  attachSubjectHandlers();
}
function attachContentHandlers() {
  $("#content").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openItem(b.dataset.edit));
  $("#content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => delItem(b.dataset.del));
  $("#content").querySelectorAll("[data-jump]").forEach((b) => b.onclick = () => { current = b.dataset.jump; $("#search").value = ""; render(); window.scrollTo(0, 0); });
  $("#content").querySelectorAll("[data-pin]").forEach((b) => b.onclick = () => togglePin(b.dataset.pin));
  $("#content").querySelectorAll("[data-goalimp]").forEach((b) => b.onclick = () => { const it = db.items.find((x) => x.id === b.dataset.goalimp); if (it) { it.important = !it.important; it.updated = new Date().toISOString(); save(); render(); } });
  $("#content").querySelectorAll("input[type=checkbox][data-item]").forEach((cb) => cb.onchange = () => toggleCheck(cb.dataset.item, +cb.dataset.ck));
}

function linkBody(i) {
  const url = i.link ? `<div class="linkrow">🔗 ${linkAnchor(i.link)}</div>` : "";
  const msg = i.message ? `<div class="lmsg">${inline(i.message)}</div>` : "";
  const why = i.reason ? `<div class="lwhy"><b>Why:</b> ${inline(i.reason)}</div>` : "";
  const extra = i.body ? `<div class="body">${mdRender(i.body, i.id)}</div>` : "";
  return `<div class="body">${url}${msg}${why}${extra}</div>`;
}
function relatedHTML(i) {
  if (!i.related || !i.related.length) return "";
  const chips = i.related.map((rid) => {
    const r = db.items.find((x) => x.id === rid); if (!r) return "";
    const rc = cat(r.category);
    return `<button class="relchip" data-jump="${r.category}">↔ ${esc(r.title || "(untitled)")} · ${rc ? esc(rc.label) : "?"}</button>`;
  }).filter(Boolean).join("");
  return chips ? `<div class="rel"><span class="rellbl">Related:</span>${chips}</div>` : "";
}
function isMissed(i) { return !!(i.periodEnd && new Date(i.periodEnd + "T23:59:59") < new Date()); }
function periodBadge(i) {
  if (!i.periodEnd) return "";
  const missed = isMissed(i);
  return `<span class="pbadge ${missed ? "missed" : "active"}">${missed ? "⏰ missed " + i.periodEnd : "📅 ends " + i.periodEnd}</span>`;
}
function progressBar(body, accent) {
  const total = (body.match(/^[ \t]*[-*][ \t]*\[( |x|X)\][ \t]+/gm) || []).length;
  if (!total) return "";
  const done = (body.match(/^[ \t]*[-*][ \t]*\[(x|X)\][ \t]+/gm) || []).length;
  const pct = Math.round((done / total) * 100);
  return `<div class="prog"><div class="pbar"><i style="width:${pct}%;background:${accent}"></i></div><span>${done}/${total} · ${pct}%</span></div>`;
}
function cardHTML(i, c) {
  const when = i.updated ? new Date(i.updated).toLocaleDateString() : "";
  const accent = i.color || c.color;
  const body = (i.category === "links") ? linkBody(i) : `<div class="body">${mdRender(i.body || "", i.id)}</div>`;
  const prog = progressBar(i.body || "", accent);
  const gstar = i.category === "todo" ? `<button class="gimp ${i.important ? "on" : ""}" data-goalimp="${i.id}" title="Show on Home">${i.important ? "⭐" : "☆"}</button>` : "";
  return `<div class="card" style="--dc:${accent}">
    ${i.title ? `<h3>${esc(i.title)}</h3>` : ""}
    ${periodBadge(i)}
    ${body}${prog}${relatedHTML(i)}
    <div class="meta"><span class="when">${when}</span>
      ${gstar}
      <button class="pin ${pins.has(i.id) ? "on" : ""}" data-pin="${i.id}" title="Show on Home (temporary)">📌</button>
      <button data-edit="${i.id}">Edit</button>
      <button class="del" data-del="${i.id}">Delete</button></div>
  </div>`;
}

/* ---------- markdown-ish render (safe) ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }
// pull the first real http(s) URL out of a (possibly messy) link field
function urlIn(s) { const m = String(s || "").match(/https?:\/\/[^\s]+/); return m ? m[0] : ""; }
// render a link field as a clickable anchor when it contains a URL; otherwise plain text (never a broken href)
function linkAnchor(raw) {
  const href = urlIn(raw);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(raw)}</a>` : `<span class="nourl">${esc(raw)}</span>`;
}
function inline(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}
function mdRender(text, itemId) {
  const lines = String(text).split(/\r?\n/);
  let html = "", inList = false, ck = 0;
  const close = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const ln of lines) {
    const t = ln.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.*)$/);          // checkbox line
    if (t && itemId != null) {
      if (!inList) { html += "<ul>"; inList = true; }
      const done = t[1].toLowerCase() === "x";
      html += `<li class="task"><label><input type="checkbox" data-item="${itemId}" data-ck="${ck}" ${done ? "checked" : ""}/><span class="${done ? "done" : ""}">${inline(t[2])}</span></label></li>`;
      ck++; continue;
    }
    const m = ln.match(/^\s*[-*•]\s+(.*)$/) || ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li><span>${inline(m[1])}</span></li>`; }
    else { close(); if (ln.trim()) html += `<div>${inline(ln)}</div>`; }
  }
  close();
  return html || "<div></div>";
}
function toggleCheck(itemId, n) {
  const it = db.items.find((x) => x.id === itemId); if (!it) return;
  let k = -1;
  it.body = it.body.split(/\r?\n/).map((ln) => {
    const m = ln.match(/^(\s*[-*]\s*\[)( |x|X)(\]\s+.*)$/);
    if (m) { k++; if (k === n) return m[1] + (m[2].toLowerCase() === "x" ? " " : "x") + m[3]; }
    return ln;
  }).join("\n");
  it.updated = new Date().toISOString();
  save(); render();
}

/* ---------- item CRUD ---------- */
function openItem(id) {
  editingId = id || null;
  const i = id ? db.items.find((x) => x.id === id) : null;
  $("#itemModalTitle").textContent = id ? "Edit entry" : "Add entry";
  $("#fCat").innerHTML = db.categories.filter((c) => c.id !== "home" && c.id !== "subjects").map((c) => `<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join("");
  $("#fCat").value = i ? i.category : current;
  refreshSectionList($("#fCat").value);
  $("#fSection").value = i ? (i.section || "") : "";
  $("#fTitle").value = i ? (i.title || "") : "";
  $("#fBody").value = i ? (i.body || "") : "";
  $("#fLink").value = (i && i.link) || "";
  $("#fMessage").value = (i && i.message) || "";
  $("#fReason").value = (i && i.reason) || "";
  const accent = i && i.color;
  $("#fColorOn").checked = !!accent;
  $("#fColor").value = accent || ((cat(i ? i.category : current) || {}).color || "#7c9cff");
  applyModalContext($("#fCat").value);
  showModal("itemModal", true);
  setTimeout(() => $("#fTitle").focus(), 50);
}
function applyModalContext(catId) {
  const isLink = catId === "links", isTodo = catId === "todo";
  $("#grpLink").style.display = isLink ? "block" : "none";
  $("#grpBody").style.display = isLink ? "none" : "block";
  $("#lblSection").textContent = isLink ? "Tag" : isTodo ? "Goal type" : "Section";
  $("#lblTitle").textContent = isLink ? "Label" : "Title";
}
$("#fCat").onchange = () => { refreshSectionList($("#fCat").value); applyModalContext($("#fCat").value); };
function refreshSectionList(catId) {
  const secs = [...new Set(itemsOf(catId).map((i) => i.section || "General"))];
  $("#sectionList").innerHTML = secs.map((s) => `<option value="${esc(s)}">`).join("");
}
$("#itemSave").onclick = () => {
  const catId = $("#fCat").value;
  const isLink = catId === "links";
  const body = $("#fBody").value.trim();
  const title = $("#fTitle").value.trim();
  const link = $("#fLink").value.trim();
  if (!body && !title && !link) { toast("Nothing to save"); return; }
  const now = new Date().toISOString();
  const color = $("#fColorOn").checked ? $("#fColor").value : null;
  const target = editingId
    ? db.items.find((x) => x.id === editingId)
    : (db.items.push({ id: uid(), created: now }), db.items[db.items.length - 1]);
  Object.assign(target, { category: catId, section: $("#fSection").value.trim() || "General", title, body, updated: now });
  if (isLink) { target.link = link; target.message = $("#fMessage").value.trim(); target.reason = $("#fReason").value.trim(); }
  else if (!isLinkSection(target.section)) { delete target.link; delete target.message; delete target.reason; }  // never strip a LINKS item's url
  if (color) target.color = color; else delete target.color;
  current = catId;
  showModal("itemModal", false); save(); render();
};

/* ---------- goals (To-Do) ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function isoDay(d) { return d.toISOString().slice(0, 10); }
function weekOfMonth(d) { return Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1); }
function weekRange(n) {
  const now = new Date(), d = new Date(now.getFullYear(), now.getMonth(), 1 + (n - 1) * 7);
  const dow = (d.getDay() + 6) % 7;                 // Mon = 0
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return [isoDay(mon), isoDay(sun)];
}
function fillMonthYear() {
  $("#gMonth").innerHTML = MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  const y = new Date().getFullYear();
  $("#gYear").innerHTML = [y, y + 1].map((v) => `<option value="${v}">${v}</option>`).join("");
  $("#gMonth").value = new Date().getMonth(); $("#gYear").value = y;
}
function applyGoalType() {
  const t = $("#gType").value;
  $("#gWeekShorts").style.display = t === "Weekly" ? "" : "none";
  $("#gDateRow").style.display = t === "Weekly" ? "" : "none";
  $("#gMonthRow").style.display = t === "Monthly" ? "" : "none";
  if (t === "Weekly") {
    const wk = weekOfMonth(new Date()); const [a, b] = weekRange(wk);
    $("#gStart").value = a; $("#gEnd").value = b;
    $("#gWeekShorts").querySelectorAll(".wk").forEach((x) => x.classList.toggle("on", +x.dataset.wk === wk));
  } else { $("#gStart").value = ""; $("#gEnd").value = ""; }
}
$("#gType").onchange = applyGoalType;
$("#gWeekShorts").addEventListener("click", (e) => {
  const b = e.target.closest(".wk"); if (!b) return;
  const [a, c] = weekRange(+b.dataset.wk); $("#gStart").value = a; $("#gEnd").value = c;
  $("#gWeekShorts").querySelectorAll(".wk").forEach((x) => x.classList.toggle("on", x === b));
});
$("#addGoals").onclick = () => {
  $("#gType").value = "Weekly"; $("#gTag").value = ""; $("#gGoals").value = "";
  $("#gFile").value = ""; $("#gColor").value = (cat("todo") || {}).color || "#56d4a0";
  fillMonthYear(); applyGoalType();
  showModal("goalsModal", true);
};
$("#gFile").onchange = () => {
  const f = $("#gFile").files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { $("#gGoals").value = ($("#gGoals").value + "\n" + rd.result).trim(); };
  rd.readAsText(f);
};
$("#goalsSave").onclick = () => {
  const raw = $("#gGoals").value.trim();
  const goals = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (!goals.length) { toast("No goals entered"); return; }
  const t = $("#gType").value, now = new Date().toISOString();
  const item = {
    id: uid(), category: "todo", section: t,
    title: $("#gTag").value.trim() || (t + " goals"),
    body: goals.map((g) => `- [ ] ${g}`).join("\n"),
    color: $("#gColor").value, created: now, updated: now,
  };
  if (t === "Weekly") { if ($("#gStart").value) item.periodStart = $("#gStart").value; if ($("#gEnd").value) item.periodEnd = $("#gEnd").value; }
  else if (t === "Monthly") {
    const m = +$("#gMonth").value, y = +$("#gYear").value;
    item.periodStart = isoDay(new Date(y, m, 1));
    item.periodEnd = isoDay(new Date(y, m + 1, 0));
    if (!$("#gTag").value.trim()) item.title = `${MONTHS[m]} ${y} goals`;
  }
  db.items.push(item);
  current = "todo"; showModal("goalsModal", false); save(); render();
};
$("#goalsCancel").onclick = () => showModal("goalsModal", false);
function delItem(id) {
  const i = db.items.find((x) => x.id === id);
  if (!confirm(`Delete "${(i && i.title) || "this entry"}"?`)) return;
  db.items = db.items.filter((x) => x.id !== id); save(); render();
}

/* ---------- category CRUD (rename / delete only — categories are AI-created) ---------- */
$("#renCat").onclick = () => {
  const c = cat(current); if (!c) return;
  const label = prompt("Rename menu:", c.label); if (label === null) return;
  c.label = label.trim() || c.label;
  const icon = prompt("Icon (emoji):", c.icon || "📌"); if (icon !== null) c.icon = icon.trim() || c.icon;
  save(); render();
};
$("#delCat").onclick = () => {
  const c = cat(current); if (!c) return;
  const n = itemsOf(current).length;
  if (!confirm(`Delete menu "${c.label}" and its ${n} entries?`)) return;
  db.items = db.items.filter((i) => i.category !== current);
  db.categories = db.categories.filter((x) => x.id !== current);
  current = db.categories[0] ? db.categories[0].id : null;
  save(); render();
};

/* ---------- export to Desktop (per-page / per-carousel folder tree, see exports.md) ---------- */
async function doExport(category, section) {
  toast("Exporting " + (section || (cat(category) || {}).label || "") + " …");
  try {
    const r = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, section: section || null }) }).then((x) => x.json());
    toast(r.ok ? `Exported ${r.files} file(s)${r.images ? ", " + r.images + " image(s)" : ""} → ${r.dir}` : "Export failed");
  } catch { toast("Export failed — is the server running?"); }
}
$("#exportCat").onclick = () => { const c = cat(current); if (c) doExport(current); };

/* ---------- modal helpers ---------- */
function showModal(id, on) { $("#" + id).classList.toggle("show", on); }
$("#addItem").onclick = () => openItem(null);
$("#quickAdd").onclick = () => {
  openItem(null);
  $("#fCat").value = "instant"; refreshSectionList("instant"); applyModalContext("instant");
  $("#fSection").value = "Inbox";
  $("#itemModalTitle").textContent = "⚡ Quick add (Instant)";
  setTimeout(() => $("#fBody").focus(), 60);
};
// Quick items: side button opens the quick-add inbox (the instant store) to review / categorize dumps
$("#quickView").onclick = () => { current = "instant"; $("#search").value = ""; render(); window.scrollTo(0, 0); };
$("#itemCancel").onclick = () => showModal("itemModal", false);
// click anywhere else closes any open carousel ⚙ menu
document.addEventListener("click", () => { document.querySelectorAll(".carmenu").forEach((m) => { m.hidden = true; }); });
$("#search").oninput = () => render();
document.querySelectorAll(".modal").forEach((m) => m.onclick = (e) => { if (e.target === m) m.classList.remove("show"); });
$("#lightbox").onclick = closeLightbox;
$("#lbInner").onclick = (e) => e.stopPropagation();
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { document.querySelectorAll(".modal").forEach((m) => m.classList.remove("show")); closeLightbox(); }
  if (lbState && lbState.list.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    lbState.idx = (lbState.idx + (e.key === "ArrowRight" ? 1 : -1) + lbState.list.length) % lbState.list.length; paintLightbox();
  }
});

/* ================= Home (live, never saved) ================= */
// Note pins persist across refresh (localStorage), NOT in the DB/backup. Carousel "show on Home"
// marks live in db.settings.carousels (persisted, per the carousel standard).
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } }
const pins = new Set(lsGet("tatva_pins"));               // pinned note ids
function savePins() { localStorage.setItem("tatva_pins", JSON.stringify([...pins])); }
let homeTimers = [];
let weatherCache = null;
function stopHomeTimers() { homeTimers.forEach(clearInterval); homeTimers = []; }
function togglePin(id) { pins.has(id) ? pins.delete(id) : pins.add(id); savePins(); render(); }

function fmtBytes(n) {
  if (!n || n < 1) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
}
function weatherText(code) {
  const m = { 0: "☀️ Clear", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast", 45: "🌫️ Fog", 48: "🌫️ Fog", 51: "🌦️ Drizzle", 53: "🌦️ Drizzle", 55: "🌦️ Drizzle", 61: "🌧️ Rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain", 71: "🌨️ Snow", 73: "🌨️ Snow", 75: "🌨️ Snow", 80: "🌦️ Showers", 81: "🌦️ Showers", 82: "⛈️ Heavy showers", 95: "⛈️ Thunderstorm" };
  return m[code] || "🌡️";
}
function paintWeather(w) {
  const el = $("#hWeather"); if (el) el.innerHTML = `${weatherText(w.weather_code)} <b>${Math.round(w.temperature_2m)}°C</b> · 💨 ${Math.round(w.wind_speed_10m)} km/h`;
  const sub = document.getElementById("hSubline");
  if (sub) sub.innerHTML = `${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${weatherText(w.weather_code)} ${Math.round(w.temperature_2m)}°C`;
}
function loadWeather() {
  if (weatherCache && Date.now() - weatherCache.t < 10 * 60 * 1000) return paintWeather(weatherCache);
  const go = (lat, lon) => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`)
    .then((r) => r.json()).then((j) => { weatherCache = { ...j.current, t: Date.now() }; paintWeather(weatherCache); })
    .catch(() => { const el = $("#hWeather"); if (el) el.textContent = "weather unavailable"; });
  if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => go(p.coords.latitude, p.coords.longitude), () => go(28.61, 77.21), { timeout: 5000 });
  else go(28.61, 77.21);
}
async function pollSys() {
  try {
    const j = await fetch("/api/sysinfo").then((r) => r.json());
    if (!$("#hCpu")) return;
    $("#hCpu").style.width = j.cpu + "%"; $("#hCpuV").textContent = j.cpu + "%";
    const mp = j.mem.total ? Math.round(100 * j.mem.used / j.mem.total) : 0;
    $("#hRam").style.width = mp + "%"; $("#hRamV").textContent = `${fmtBytes(j.mem.used)} / ${fmtBytes(j.mem.total)}`;
    const dp = j.disk.total ? Math.round(100 * j.disk.used / j.disk.total) : 0;
    $("#hDisk").style.width = dp + "%"; $("#hDiskV").textContent = `${fmtBytes(j.disk.used)} / ${fmtBytes(j.disk.total)}`;
    $("#hNet").textContent = `↓ ${fmtBytes(j.net.down)}/s    ↑ ${fmtBytes(j.net.up)}/s`;
  } catch {}
}
function tickClock() {
  const el = $("#hClock"); if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleTimeString();
  $("#hDate").textContent = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
/* ---------- Home quote: changes every hour, fetched online; curated Greek/Western/Indian fallback ----------
   The quote is cached per-hour in localStorage so it stays fixed for the hour and only changes when the
   hour rolls over (a 1-min timer on Home re-checks). ASCII only. */
const QUOTES = [
  // Greek
  { text: "We are what we repeatedly do. Excellence, then, is not an act but a habit.", by: "Aristotle" },
  { text: "The secret of change is to focus all your energy not on fighting the old, but on building the new.", by: "Socrates" },
  { text: "The first and greatest victory is to conquer yourself.", by: "Plato" },
  { text: "No man ever steps in the same river twice.", by: "Heraclitus" },
  { text: "It is not what happens to you, but how you react to it that matters.", by: "Epictetus" },
  // Western / English
  { text: "The secret of getting ahead is getting started.", by: "Mark Twain" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", by: "Winston Churchill" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", by: "Ralph Waldo Emerson" },
  { text: "An investment in knowledge pays the best interest.", by: "Benjamin Franklin" },
  { text: "Believe you can and you're halfway there.", by: "Theodore Roosevelt" },
  // Indian
  { text: "The future depends on what you do today.", by: "Mahatma Gandhi" },
  { text: "Arise, awake, and stop not till the goal is reached.", by: "Swami Vivekananda" },
  { text: "You can't cross the sea merely by standing and staring at the water.", by: "Rabindranath Tagore" },
  { text: "Dream is not that which you see while sleeping, it is something that does not let you sleep.", by: "A. P. J. Abdul Kalam" },
  { text: "What we think, we become.", by: "Gautama Buddha" },
];
function hourKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`; }
function curatedForHour() { const idx = Math.abs(parseInt(hourKey().replace(/-/g, ""), 10)) % QUOTES.length; return QUOTES[idx]; }
let quoteCache = (() => { try { return JSON.parse(localStorage.getItem("tatva_quote") || "null"); } catch { return null; } })();
function quoteMarkup(q) { return `&ldquo;${esc(q.text)}&rdquo;<span class="hqauth">— ${esc(q.by)}</span>`; }
function fetchT(url, ms = 4000) { return fetch(url, { signal: AbortSignal.timeout(ms) }); }
async function fetchOnlineQuote() {
  const sources = [
    async () => { const j = await (await fetchT("https://api.quotable.io/random")).json(); return { text: j.content, by: j.author }; },
    async () => { const j = await (await fetchT("https://dummyjson.com/quotes/random")).json(); return { text: j.quote, by: j.author }; },
  ];
  for (const s of sources) { try { const q = await s(); if (q && q.text) return q; } catch {} }
  return null;
}
async function loadQuote() {
  const el = document.getElementById("hQuote"); if (!el) return;
  const key = hourKey();
  if (quoteCache && quoteCache.key === key) { el.innerHTML = quoteMarkup(quoteCache); return; }  // same hour → keep it
  const online = await fetchOnlineQuote();
  quoteCache = online ? { key, ...online } : { key, ...curatedForHour() };
  try { localStorage.setItem("tatva_quote", JSON.stringify(quoteCache)); } catch {}
  const e2 = document.getElementById("hQuote"); if (e2) e2.innerHTML = quoteMarkup(quoteCache);
}

function homeGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Good night";
}
// count [ ] / [x] checkboxes across a set of items
function taskCounts(items) {
  let done = 0, total = 0;
  for (const i of items) {
    const body = i.body || "";
    total += (body.match(/^[ \t]*[-*][ \t]*\[( |x|X)\][ \t]+/gm) || []).length;
    done += (body.match(/^[ \t]*[-*][ \t]*\[(x|X)\][ \t]+/gm) || []).length;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function renderHome(c) {
  const todo = itemsOf("todo");
  const goalItems = todo.filter((i) => i.important);   // only ⭐-marked goals show on Home (pages.md)
  const pinned = db.items.filter((i) => pins.has(i.id) && i.category !== "todo");   // goals already show in the Goals card — don't duplicate them in Pinned

  // ---- top chips + "to categorize" counts ----
  const inbox = itemsOf("instant");
  const textsToSort = inbox.filter((i) => i.kind !== "image" && !i.file).length;
  const subjInstant = itemsOf("subjects").filter((i) => (i.section || "Instant") === "Instant").length;
  const imagesToSort = inbox.filter((i) => i.kind === "image" || i.file).length + subjInstant;
  const toCat = textsToSort + imagesToSort;

  // ---- stat cards (derived from existing data; Focus-of-week chart intentionally omitted) ----
  const allTasks = taskCounts(todo);
  const weekly = taskCounts(todo.filter((i) => i.section === "Weekly"));
  const addedWeek = db.items.filter((i) => i.created && Date.now() - new Date(i.created).getTime() < 7 * 864e5).length;
  const stat = (icon, val, label, badge, pct, color) => `
    <div class="hstat" style="--dc:${color}">
      <div class="hstop"><span class="hsico">${icon}</span><span class="hsbadge">${esc(badge)}</span></div>
      <div class="hsval">${val}</div><div class="hslbl">${esc(label)}</div>
      <div class="hsbar"><i style="width:${pct}%"></i></div>
    </div>`;
  const statsHTML = `<div class="hstats">
    ${stat("✅", `${allTasks.done}/${allTasks.total}`, "Tasks done", "today", allTasks.pct, "#56d4a0")}
    ${stat("📈", `${weekly.pct}%`, "Weekly goals", `${weekly.done} of ${weekly.total}`, weekly.pct, "#7c9cff")}
    ${stat("📁", `${toCat}`, "To categorize", "queued", Math.min(100, toCat * 4), "#ffb454")}
    ${stat("📥", `${addedWeek}`, "Added this week", "7 days", Math.min(100, addedWeek * 4), "#b083f0")}
  </div>`;

  // ---- goals: each its own sub-card with tickable checkboxes + attached progress ----
  const goalIcon = (i) => i.section === "Weekly" ? "🗓️" : i.section === "Monthly" ? "📅" : "⭐";
  const goalRow = (i) => {
    const accent = i.color || c.color, tc = taskCounts([i]);
    const period = i.periodEnd ? `<small class="hgper ${isMissed(i) ? "missed" : ""}">${isMissed(i) ? "⏰ " + i.periodEnd : "📅 " + i.periodEnd}</small>` : "";
    return `<div class="hgoal" style="--dc:${accent}">
      <div class="hgname"><span class="hgttl">${goalIcon(i)} ${esc(i.title || i.section || "Goal")}</span>
        ${i.section ? `<span class="hgtype">${esc(i.section)}</span>` : ""}${period}
        <span class="hgpct">${tc.done}/${tc.total} · ${tc.pct}%</span></div>
      ${progressBar(i.body || "", accent)}
      <div class="hgtasks">${mdRender(i.body || "", i.id)}</div>
    </div>`;
  };
  const goalsHTML = `<div class="hcard hgoals">
    <div class="hcardhd"><h4>🎯 Goals</h4><span class="hcardsub">this week &amp; one-time</span></div>
    ${goalItems.length ? goalItems.map(goalRow).join("") : `<div class="hempty">Mark a To-Do goal ⭐ (or add a weekly/monthly goal) to show it here.</div>`}
  </div>`;

  // ---- quick actions (page = where the button takes you, shown under the label) ----
  const qa = (icon, label, page, act) => `<button class="hqa" data-qa="${act}"><span class="hqaico">${icon}</span><span class="hqalbl">${esc(label)}</span><span class="hqapage">${esc(page)}</span></button>`;
  const quickHTML = `<div class="hcard hquick">
    <div class="hcardhd"><h4>⚡ Quick actions</h4></div>
    <div class="hqagrid">
      ${qa("➕", "New text", "Quick add", "newtext")}${qa("🖼️", "Add image", "Subjects", "addimg")}${qa("🎯", "New goal", "To-Do", "newgoal")}
      ${qa("🔮", "Consult", "Astrology", "consult")}${qa("📌", "Pin note", "Short Notes", "pin")}${qa("⌘", "Command", "Programming", "cmd")}
    </div></div>`;

  // ---- quote (hourly, online; cached per hour) ----
  const initQ = (quoteCache && quoteCache.key === hourKey()) ? quoteCache : curatedForHour();
  const quoteHTML = `<div class="hcard hquotecard"><div class="hqmark">&ldquo;</div><div class="hquote" id="hQuote">${quoteMarkup(initQ)}</div></div>`;

  // ---- home-marked carousels (pages.md: carousels you mark "Show on Home" render here) ----
  let homeCarHTML = "";
  for (const pid of Object.keys(PAGES)) {
    const pcat = cat(pid); if (!pcat) continue;
    const pitems = itemsOf(pid), dflt = pageDefaultSection(pid);
    const show = [...new Set(pitems.map((i) => i.section || dflt))].filter((s) => carHome(pid, s));
    homeCarHTML += sortedSections(pid, show).map((s) => subjectCarousel(pid, s, pitems.filter((i) => (i.section || dflt) === s), pcat)).join("");
  }

  const dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#content").innerHTML = `
  <div class="homewrap">
    <div class="hhero">
      <div class="hherotop">
        <div class="hheroL">
          <div class="hlive">● LIVE DASHBOARD</div>
          <h2 class="hgreet">${homeGreeting()}, rishabh</h2>
          <div class="hsubline" id="hSubline">${dateLine} · loading weather…</div>
        </div>
        <div class="hchips">
          <span class="hchip">🗒️ <b>${textsToSort}</b> texts to sort</span>
          <span class="hchip">🖼️ <b>${imagesToSort}</b> images to sort</span>
        </div>
      </div>
      ${statsHTML}
    </div>

    <div class="home">
      <div class="homemain">${goalsHTML}</div>
      <div class="homeside">
        <aside class="widget">
          <div class="wclock" id="hClock">--:--:--</div>
          <div class="wdate" id="hDate"></div>
          <div class="wweather" id="hWeather">loading weather…</div>
          <div class="wstat"><label>CPU <span id="hCpuV">–</span></label><div class="wbar"><i id="hCpu"></i></div></div>
          <div class="wstat"><label>RAM <span id="hRamV">–</span></label><div class="wbar"><i id="hRam"></i></div></div>
          <div class="wstat"><label>Disk <span id="hDiskV">–</span></label><div class="wbar"><i id="hDisk"></i></div></div>
          <div class="wnet" id="hNet">↓ –   ↑ –</div>
        </aside>
        ${quickHTML}
        ${quoteHTML}
      </div>
    </div>

    <div id="hProjects" class="homeprojects"></div>
    ${homeCarHTML}
    ${pinned.length ? `<div class="hsec">📌 Pinned (temporary)</div><div class="grid">${pinned.map((i) => cardHTML(i, cat(i.category) || c)).join("")}</div>` : ""}
  </div>`;

  tickClock(); pollSys(); loadWeather(); loadQuote(); loadHomeProjects();
  homeTimers.push(setInterval(tickClock, 1000));
  homeTimers.push(setInterval(pollSys, 2500));
  homeTimers.push(setInterval(loadQuote, 60000));   // re-check each minute; only swaps when the hour rolls over
  attachContentHandlers();
  attachSubjectHandlers();

  // quick-action buttons
  $("#content").querySelectorAll("[data-qa]").forEach((b) => b.onclick = () => {
    const a = b.dataset.qa;
    if (a === "newtext") $("#quickAdd").click();
    else if (a === "newgoal") $("#addGoals").click();
    else if (a === "addimg") { current = "subjects"; render(); window.scrollTo(0, 0); setTimeout(() => $("#addImage").click(), 60); }
    else if (a === "consult") { current = "astrology"; render(); window.scrollTo(0, 0); }
    else if (a === "pin") { current = "shortnotes"; render(); window.scrollTo(0, 0); }
    else if (a === "cmd") { current = "programming"; render(); window.scrollTo(0, 0); }
  });
}

/* ================= Subjects (image carousels) ================= */
let imgSel = new Set();   // selected Instant images for multi-move
let lbState = null;       // lightbox gallery state (whole subject)

function slideHTML(i) {
  const isFile = !!i.file;                 // image or text file lives in store/images/
  let media, caption;
  if (i.kind === "image") {
    media = `<img loading="lazy" data-light="${i.id}" src="/images/${encodeURIComponent(i.file)}" alt="${esc(i.title || i.file)}" />`;
    caption = esc(i.title || i.file || "");
  } else if (i.kind === "text") {
    media = `<div class="textcard" data-light="${i.id}">${esc(i.body || "").slice(0, 1500)}</div>`;
    caption = esc(i.title || i.file || "");
  } else {                                 // note / link entry
    const link = i.link ? `<div class="nlink">🔗 ${linkAnchor(i.link)}</div>` : "";
    const why = i.reason ? `<div class="nwhy"><b>Why:</b> ${inline(i.reason)}</div>` : "";
    media = `<div class="notecard" data-light="${i.id}"><div class="ntitle">${esc(i.title || "(untitled)")}</div>${link}<div class="nbody">${mdRender(i.body || "", i.id)}</div>${why}</div>`;
    caption = "";
  }
  const msg = i.message ? `<div class="smsg" title="${esc(i.message)}">💬 ${esc(i.message)}</div>` : "";
  // link items on per-page LINKS carousels edit via the link modal (keeps the URL — see openLinkEditor)
  const isLinkItem = (!!i.link || isLinkSection(i.section)) && i.category !== "links";
  const editBtn = isFile
    ? `<button data-ren="${i.id}" title="rename file">✎</button>`
    : `<button data-${isLinkItem ? "editlink" : "edit"}="${i.id}" title="edit ${isLinkItem ? "link" : "entry"}">✎</button>`;
  const dlBtn = isFile ? `<button data-dl="${i.id}" title="download">⬇</button>` : "";
  return `<div class="slide ${i.important ? "imp" : ""} ${i.kind ? "" : "note"}">
    <input type="checkbox" class="ssel" data-sel="${i.id}" ${imgSel.has(i.id) ? "checked" : ""} title="select to move" />
    ${media}
    ${caption ? `<div class="scap">${caption}</div>` : ""}
    ${msg}
    <div class="sctl">
      <button data-imp="${i.id}" title="important item">${i.important ? "⭐" : "☆"}</button>
      <button data-msg="${i.id}" title="special message" class="${i.message ? "on" : ""}">💬</button>
      <button data-copy="${i.id}" title="copy to clipboard">⧉</button>
      ${dlBtn}${editBtn}
      <button data-move="${i.id}" title="move to another carousel">→</button>
      <button class="del" data-dimg="${i.id}" title="delete">🗑</button>
    </div></div>`;
}
/* ----- carousel meta: per (category + section), persisted in db.settings.carousels ----- */
function carKey(category, section) { return category + "/" + section; }
function carMap() { if (!db.settings.carousels) db.settings.carousels = {}; return db.settings.carousels; }
function carMeta(category, section) { return carMap()[carKey(category, section)]; }
function ensureCar(category, section) { const k = carKey(category, section), m = carMap(); if (!m[k]) m[k] = {}; return m[k]; }
function carImp(category, section) { const m = carMeta(category, section); return !!(m && m.important); }
function carHome(category, section) { const m = carMeta(category, section); return !!(m && m.home); }
function carMsg(category, section) { const m = carMeta(category, section); return (m && m.msg) || ""; }
function carColor(category, section) { const m = carMeta(category, section); return (m && m.color) || ""; }
function carAccent(category, section, fallback) {
  return carColor(category, section) || (carImp(category, section) ? "#ffcf4d" : fallback);
}
function carOrderVal(category, section) { const m = carMeta(category, section); return m && typeof m.order === "number" ? m.order : null; }
function splitCar(s) { const i = s.indexOf("|"); return [s.slice(0, i), s.slice(i + 1)]; }
function subjectImp(s) { return carImp("subjects", s); }
function defaultRank(category, s) {
  if (isInstantPage(category) && s === "Instant") return -1;   // inbox stays on top by default
  return carImp(category, s) ? 0 : 1;                          // important carousels first
}
function sortedSections(category, sections) {
  const arr = [...sections];
  if (arr.length && arr.every((s) => carOrderVal(category, s) != null))
    return arr.sort((a, b) => carOrderVal(category, a) - carOrderVal(category, b));   // manual order wins once set
  return arr.sort((a, b) => defaultRank(category, a) - defaultRank(category, b) || a.localeCompare(b));
}
function sectionsOf(category) {
  const dflt = pageDefaultSection(category);
  return [...new Set(itemsOf(category).map((i) => i.section || dflt))];
}
function toggleCarImportant(category, section) { const m = ensureCar(category, section); m.important = !m.important; save(); render(); }
function toggleCarHome(category, section) { const m = ensureCar(category, section); m.home = !m.home; save(); render(); }
function setCarMessage(category, section) {
  const m = ensureCar(category, section);
  const v = prompt("Carousel header message (applies to the whole carousel):", m.msg || ""); if (v === null) return;
  if (v.trim()) m.msg = v.trim(); else delete m.msg;
  save(); render();
}
function setCarColor(category, section, color) { const m = ensureCar(category, section); m.color = color; save(); render(); }
// rename a carousel. On cat-Links pages a links carousel asks for the category only → "LINKS - {new}".
function renameCar(category, section) {
  let next;
  if (pageCfg(category).catLinks && isLinkSection(section)) {
    const curCat = /^LINKS - /.test(section) ? section.slice(8) : "";
    const v = prompt('Links category (carousel becomes "LINKS - …"):', curCat); if (v === null) return;
    next = linkSection(category, v);
  } else {
    const v = prompt("Rename carousel:", section); if (v === null) return;
    next = v.trim(); if (!next) return;
  }
  if (next === section) return;
  const dflt = pageDefaultSection(category), now = new Date().toISOString();
  db.items.forEach((it) => { if (it.category === category && (it.section || dflt) === section) { it.section = next; it.updated = now; } });
  const m = carMap(), oldK = carKey(category, section), newK = carKey(category, next);
  if (m[oldK]) { m[newK] = Object.assign(m[newK] || {}, m[oldK]); delete m[oldK]; }
  save(); render(); toast("Renamed to " + next);
}
// delete a whole carousel and its items (image/text files are soft-deleted to backups/images on the server).
async function deleteCar(category, section) {
  const dflt = pageDefaultSection(category);
  const list = db.items.filter((it) => it.category === category && (it.section || dflt) === section);
  if (!confirm(`Delete carousel "${section}" and its ${list.length} item(s)?`)) return;
  for (const it of list) { if (it.file) { try { await fetch("/api/delete-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: it.file }) }); } catch {} } }
  const ids = new Set(list.map((i) => i.id));
  db.items = db.items.filter((i) => !ids.has(i.id));
  delete carMap()[carKey(category, section)];
  save(); render(); toast("Deleted carousel " + section);
}
function reorderCar(category, sections, section, dir) {
  const sorted = sortedSections(category, sections);
  sorted.forEach((s, i) => { ensureCar(category, s).order = i; });   // normalize to explicit positions
  const idx = sorted.indexOf(section), j = idx + dir;
  if (j < 0 || j >= sorted.length) return;
  const a = ensureCar(category, sorted[idx]), b = ensureCar(category, sorted[j]);
  const t = a.order; a.order = b.order; b.order = t;
  save(); render();
}
function carHeader(category, section, num, total, count) {
  const k = `${esc(category)}|${esc(section)}`;
  const imp = carImp(category, section), home = carHome(category, section), msg = carMsg(category, section);
  const color = carColor(category, section) || carAccent(category, section, (cat(category) || {}).color || "#b083f0");
  // reorder (↑↓) stays loose; everything else lives in the ⚙ settings menu (per carousel_std.md)
  return `<div class="subhead">
    <span class="cnum">#${num}</span>
    <b>${esc(section)}</b><span class="ccount">${count}</span>
    <span class="carmove">
      <button class="cmv" data-carup="${k}" title="move up" ${num <= 1 ? "disabled" : ""}>↑</button>
      <button class="cmv" data-cardn="${k}" title="move down" ${num >= total ? "disabled" : ""}>↓</button>
    </span>
    <span class="carset">
      <button class="carcog" data-carcog="${k}" title="carousel settings">⚙</button>
      <div class="carmenu" hidden>
        <button class="cm-item ${imp ? "on" : ""}" data-carimp="${k}">${imp ? "⭐" : "☆"} Important — show first on this page</button>
        <button class="cm-item ${home ? "on" : ""}" data-carhome="${k}">${home ? "🏠" : "⌂"} Show on Home</button>
        <button class="cm-item ${msg ? "on" : ""}" data-carmsg="${k}">📝 Header message</button>
        <label class="cm-item cm-color">🎨 Colour <input type="color" class="carcolor" data-carcolor="${k}" value="${color}" /></label>
        <button class="cm-item" data-carrename="${k}">✏️ Rename carousel</button>
        <button class="cm-item" data-carexp="${k}">⬇ Export to Desktop</button>
        <button class="cm-item danger" data-cardel="${k}">🗑 Delete carousel</button>
      </div>
    </span>
  </div>${msg ? `<div class="carmsg">${esc(msg)}</div>` : ""}`;
}
function setMessage(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  const m = prompt("Special message for this item:", it.message || ""); if (m === null) return;
  it.message = m.trim(); it.updated = new Date().toISOString(); save(); render();
}
function imgCarousel(list, accent) {
  const sorted = [...list].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
  const slides = sorted.map(slideHTML).join("") || `<div class="hempty">no items</div>`;
  return `<div class="carousel" style="--dc:${accent}">
    <div class="chead"><button class="movesel" data-movesel="1">Move selected (${imgSel.size}) →</button>
      <span class="cnav"><button class="cprev">◀</button><button class="cnext">▶</button></span></div>
    <div class="cstrip">${slides}</div></div>`;
}
function subjectCarousel(category, subject, list, c) {   // read-only block (used on Home — its own colour)
  const accent = carColor(category, subject) || (subject === "Instant" ? "#ffd166" : "#5ad1e6");
  const msg = carMsg(category, subject);
  return `<div class="subject homecar" style="--dc:${accent}">
    <div class="subhead"><b>${esc(subject)}</b><span class="ccount">${list.length}</span></div>
    ${msg ? `<div class="carmsg">💬 ${esc(msg)}</div>` : ""}${imgCarousel(list, accent)}</div>`;
}
function renderSubjects(c) {
  const items = itemsOf("subjects");
  if (!items.length) { $("#content").innerHTML = `<div class="empty">No images yet — hit <b>+ Add image</b>. Leave the subject blank to drop into Instant.</div>`; return; }
  const subjects = sortedSections("subjects", [...new Set(items.map((i) => i.section || "Instant"))]);
  const total = subjects.length;
  $("#content").innerHTML = subjects.map((s, idx) => {
    const all = items.filter((i) => (i.section || "Instant") === s);
    const normal = all.filter((i) => i.part !== "material");
    const material = all.filter((i) => i.part === "material");
    const isInstant = s === "Instant", imp = carImp("subjects", s);
    const accent = carAccent("subjects", s, isInstant ? "#ffd166" : (c.color || "#b083f0"));
    const mat = material.length
      ? `<div class="material"><button class="matog" data-mat="mat_${idx}">📖 Material (${material.length}) <span class="caret">▸</span></button><div class="matbody" id="mat_${idx}" style="display:none">${imgCarousel(material, accent)}</div></div>`
      : "";
    return `<div class="subject ${isInstant ? "instant" : ""} ${imp ? "impcar" : ""}" style="--dc:${accent}">
      ${carHeader("subjects", s, idx + 1, total, all.length + " img")}
      ${imgCarousel(normal, accent)}${mat}</div>`;
  }).join("");
  attachSubjectHandlers();
}
function updateMoveBar() { $("#content").querySelectorAll("[data-movesel]").forEach((b) => b.textContent = `Move selected (${imgSel.size}) →`); }
function moveSelected() {
  if (!imgSel.size) { toast("Select item(s) first (checkboxes)"); return; }
  const now = new Date().toISOString();
  // From the Quick items inbox: transfer to a real page + carousel (changes category, not just section)
  if (current === "instant") {
    const pages = db.categories.filter((c) => isStandard(c.id));
    const pick = prompt(`Transfer ${imgSel.size} item(s) to which page?\n\n` + pages.map((c, i) => `${i + 1}. ${c.label}`).join("\n"), "1");
    if (pick === null) return;
    const key = String(pick).trim().toLowerCase();
    const page = pages[parseInt(pick, 10) - 1] || pages.find((c) => c.label.toLowerCase() === key || c.id === key);
    if (!page) { toast("Unknown page — type its number or name"); return; }
    const s = prompt(`Carousel in ${page.label}:`, pageDefaultSection(page.id)); if (s === null) return;
    const subj = s.trim() || pageDefaultSection(page.id);
    if (isLinkSection(subj)) { toast("LINKS holds links only — use + Add link"); return; }
    db.items.forEach((it) => { if (imgSel.has(it.id)) { it.category = page.id; it.section = subj; it.updated = now; } });
    imgSel.clear(); save(); render(); toast(`Transferred to ${page.label} · ${subj}`); return;
  }
  const s = prompt(`Move ${imgSel.size} item(s) to carousel:`, ""); if (s === null) return;
  const subj = s.trim() || pageDefaultSection(current);
  if (isLinkSection(subj)) { toast("LINKS holds links only — use + Add link"); return; }
  db.items.forEach((it) => { if (isStandard(it.category) && imgSel.has(it.id)) { it.section = subj; it.updated = now; } });
  imgSel.clear(); save(); render(); toast("Moved to " + subj);
}
async function copyImage(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  try {
    if (it.kind === "text") { await navigator.clipboard.writeText(it.body || ""); toast("Text copied"); return; }
    if (!it.file) {   // note / link entry
      const parts = [it.title, it.link, it.body, it.reason].filter(Boolean);
      await navigator.clipboard.writeText(parts.join("\n")); toast("Copied"); return;
    }
    const blob = await fetch("/images/" + encodeURIComponent(it.file)).then((r) => r.blob());
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    toast("Image copied to clipboard");
  } catch { toast("Copy failed (browser clipboard?)"); }
}
function downloadImage(id) {
  const it = db.items.find((x) => x.id === id); if (!it || !it.file) return;
  const a = document.createElement("a"); a.href = "/images/" + encodeURIComponent(it.file); a.download = it.title || it.file;
  document.body.appendChild(a); a.click(); a.remove();
}
// thin wrapper kept for existing callers: "all" => whole page, else a single carousel
function exportSubject(s, category) { return doExport(category || "subjects", s === "all" ? null : s); }
function attachSubjectHandlers() {
  $("#content").querySelectorAll(".carousel").forEach((car) => {
    const strip = car.querySelector(".cstrip");
    car.querySelector(".cprev").onclick = () => strip.scrollBy({ left: -strip.clientWidth * 0.8, behavior: "smooth" });
    car.querySelector(".cnext").onclick = () => strip.scrollBy({ left: strip.clientWidth * 0.8, behavior: "smooth" });
  });
  $("#content").querySelectorAll("[data-light]").forEach((el) => el.onclick = () => openLightbox(el.dataset.light));
  $("#content").querySelectorAll("[data-sel]").forEach((cb) => cb.onclick = (e) => { e.stopPropagation(); cb.checked ? imgSel.add(cb.dataset.sel) : imgSel.delete(cb.dataset.sel); updateMoveBar(); });
  $("#content").querySelectorAll("[data-movesel]").forEach((b) => b.onclick = () => moveSelected());
  $("#content").querySelectorAll("[data-carimp]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carimp); toggleCarImportant(ct, s); });
  $("#content").querySelectorAll("[data-carhome]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carhome); toggleCarHome(ct, s); });
  $("#content").querySelectorAll("[data-carmsg]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carmsg); setCarMessage(ct, s); });
  $("#content").querySelectorAll("[data-carcolor]").forEach((inp) => inp.onchange = () => { const [ct, s] = splitCar(inp.dataset.carcolor); setCarColor(ct, s, inp.value); });
  $("#content").querySelectorAll("[data-carup]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carup); reorderCar(ct, sectionsOf(ct), s, -1); });
  $("#content").querySelectorAll("[data-cardn]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.cardn); reorderCar(ct, sectionsOf(ct), s, +1); });
  $("#content").querySelectorAll("[data-carexp]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carexp); exportSubject(s, ct); });
  $("#content").querySelectorAll("[data-carrename]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.carrename); renameCar(ct, s); });
  $("#content").querySelectorAll("[data-cardel]").forEach((b) => b.onclick = () => { const [ct, s] = splitCar(b.dataset.cardel); deleteCar(ct, s); });
  // ⚙ settings menu: toggle on cog, keep clicks inside from closing it
  $("#content").querySelectorAll("[data-carcog]").forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const menu = b.parentElement.querySelector(".carmenu"), willOpen = menu.hidden;
    $("#content").querySelectorAll(".carmenu").forEach((m) => m.hidden = true);
    menu.hidden = !willOpen;
  });
  $("#content").querySelectorAll(".carmenu").forEach((m) => m.onclick = (e) => e.stopPropagation());
  $("#content").querySelectorAll("[data-msg]").forEach((b) => b.onclick = () => setMessage(b.dataset.msg));
  $("#content").querySelectorAll("[data-editlink]").forEach((b) => b.onclick = () => openLinkEditor(b.dataset.editlink));
  $("#content").querySelectorAll("[data-mat]").forEach((b) => b.onclick = () => { const body = $("#" + b.dataset.mat); const open = body.style.display !== "none"; body.style.display = open ? "none" : "block"; b.querySelector(".caret").textContent = open ? "▸" : "▾"; });
  $("#content").querySelectorAll("[data-imp]").forEach((b) => b.onclick = () => { const it = db.items.find((x) => x.id === b.dataset.imp); if (it) { it.important = !it.important; save(); render(); } });
  $("#content").querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copyImage(b.dataset.copy));
  $("#content").querySelectorAll("[data-dl]").forEach((b) => b.onclick = () => downloadImage(b.dataset.dl));
  $("#content").querySelectorAll("[data-ren]").forEach((b) => b.onclick = () => renameImage(b.dataset.ren));
  $("#content").querySelectorAll("[data-move]").forEach((b) => b.onclick = () => moveImage(b.dataset.move));
  $("#content").querySelectorAll("[data-dimg]").forEach((b) => b.onclick = () => deleteImage(b.dataset.dimg));
}
function openLightbox(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  const dflt = pageDefaultSection(it.category), subject = it.section || dflt;
  const list = db.items.filter((i) => i.category === it.category && (i.section || dflt) === subject).sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
  let idx = list.findIndex((x) => x.id === id); if (idx < 0) idx = 0;
  lbState = { list, idx, subject };
  paintLightbox();
  $("#lightbox").classList.add("show");
}
function paintLightbox() {
  if (!lbState) return;
  const it = lbState.list[lbState.idx], multi = lbState.list.length > 1;
  let media;
  if (it.kind === "image") media = `<img src="/images/${encodeURIComponent(it.file)}" alt="${esc(it.title || it.file)}" />`;
  else if (it.kind === "text") media = `<div class="lbtext">${esc(it.body || "")}</div>`;
  else {   // note / link
    const link = it.link ? `<div class="lblink">🔗 ${linkAnchor(it.link)}</div>` : "";
    const why = it.reason ? `<div class="lbwhy"><b>Why:</b> ${inline(it.reason)}</div>` : "";
    media = `<div class="lbtext lbnote"><h3>${esc(it.title || "")}</h3>${link}${mdRender(it.body || "", null)}${why}</div>`;
  }
  $("#lbInner").innerHTML = `
    <div class="lbhead">${esc(lbState.subject)} · ${lbState.idx + 1}/${lbState.list.length}</div>
    <div class="lbmedia">${multi ? `<button class="lbprev">◀</button>` : ""}${media}${multi ? `<button class="lbnext">▶</button>` : ""}</div>
    ${it.kind ? `<div class="lbcap">${esc(it.title || it.file || "")}</div>` : ""}
    ${it.message ? `<div class="lbmsg">💬 ${esc(it.message)}</div>` : ""}`;
  if (multi) {
    $("#lbInner").querySelector(".lbprev").onclick = (e) => { e.stopPropagation(); lbState.idx = (lbState.idx - 1 + lbState.list.length) % lbState.list.length; paintLightbox(); };
    $("#lbInner").querySelector(".lbnext").onclick = (e) => { e.stopPropagation(); lbState.idx = (lbState.idx + 1) % lbState.list.length; paintLightbox(); };
  }
}
function closeLightbox() { lbState = null; $("#lightbox").classList.remove("show"); $("#lbInner").innerHTML = ""; }
function toggleSubjectImportant(s) { toggleCarImportant("subjects", s); }
async function renameImage(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  if (it.kind === "text") { const t = prompt("Title:", it.title || ""); if (t !== null) { it.title = t.trim(); save(); render(); } return; }
  const cur = it.file || "";
  const nf = prompt("New image file name (keep the extension):", cur); if (nf === null) return;
  const newName = nf.trim();
  try {
    if (newName && newName !== cur) {
      const r = await fetch("/api/rename-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old: cur, new: newName }) }).then((x) => x.json());
      if (!r.ok) { toast("Rename failed: " + (r.error || "")); return; }
      it.file = r.file; if (!it.title || it.title === cur) it.title = r.file;
    }
    save(); render();
  } catch { toast("Rename failed — is the server running?"); }
}
function moveImage(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  const dflt = it.category === "astrology" ? "Quick" : "Instant";
  const s = prompt("Move to carousel:", it.section || dflt); if (s === null) return;
  const dest = s.trim() || dflt;
  if (isLinkSection(dest) && !it.link) { toast("LINKS holds links only — use + Add link"); return; }
  it.section = dest; it.updated = new Date().toISOString(); save(); render();
}
async function deleteImage(id) {
  const it = db.items.find((x) => x.id === id); if (!it) return;
  if (!confirm("Delete this item?")) return;
  if (it.file) { try { await fetch("/api/delete-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: it.file }) }); } catch {} }
  db.items = db.items.filter((x) => x.id !== id); save(); render();
}

/* ================= Project manager (live from the Ignite panel, localhost:1234) =================
   Projects are NOT stored in db.json — they are fetched through the server proxy (/api/ignite-*).
   Ongoing = pinned: shown on Home and at the top of this page. Each project has its own options
   (🔥 Ignite all actions · per-action open · pin/unpin · open in Ignite) instead of edit/delete. */
const ACT_ICON = { folder: "📁", vscode: "🧩", url: "🌐", app: "🖥️", cmd: "⌨️" };
function actionBtn(a, id, idx) {
  const ic = ACT_ICON[a.type] || "▶";
  const label = esc(a.label || a.target || a.type);
  return `<button class="pact" data-paction="${id}::${idx}" title="${esc(a.type + ": " + (a.target || ""))}">${ic} ${label}</button>`;
}
function projectCard(p) {
  const color = p.color || "#ff6a13";
  const acts = (p.actions || []).map((a, idx) => actionBtn(a, p.id, idx)).join("") || `<span class="pnone">no actions</span>`;
  const pinTitle = p.ongoing ? "Unpin (remove from Home & top)" : "Pin to Home & top (mark ongoing in Ignite)";
  return `<div class="pcard ${p.ongoing ? "pinned" : ""}" style="--dc:${color}">
    <div class="phead">
      <h3>${esc(p.name || "(untitled)")}</h3>
      <button class="ppin ${p.ongoing ? "on" : ""}" data-ppin="${p.id}" data-on="${p.ongoing ? 0 : 1}" title="${pinTitle}">${p.ongoing ? "📌" : "📍"}</button>
    </div>
    ${p.description ? `<p class="pdesc">${esc(p.description)}</p>` : ""}
    <div class="pacts">${acts}</div>
    <div class="pfoot"><button class="pignite" data-pignite="${p.id}" ${(p.actions || []).length ? "" : "disabled"}>🔥 Ignite</button></div>
  </div>`;
}
async function igniteOpen(action) {
  try { const r = await fetch("/api/ignite-open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((x) => x.json());
    toast(r && !r.error ? "Opened ✓" : "Open failed — is Ignite running?"); }
  catch { toast("Ignite unreachable (localhost:1234)"); }
}
async function igniteLaunch(id) {
  toast("Igniting…");
  try { const r = await fetch("/api/ignite-launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((x) => x.json());
    toast(r && !r.error ? "🔥 Ignited" : "Launch failed — is Ignite running?"); }
  catch { toast("Ignite unreachable (localhost:1234)"); }
}
async function ignitePin(id, ongoing) {
  try { const r = await fetch("/api/ignite-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ongoing }) }).then((x) => x.json());
    if (r && r.error) { toast("Pin failed — is Ignite running?"); return false; }
    const p = igniteProjects.find((x) => x.id === id); if (p) p.ongoing = ongoing;   // keep local cache in sync
    toast(ongoing ? "📌 Pinned" : "Unpinned"); return true; }
  catch { toast("Ignite unreachable (localhost:1234)"); return false; }
}
function attachProjectHandlers(refresh) {
  $("#content").querySelectorAll("[data-paction]").forEach((b) => b.onclick = () => {
    const [id, idx] = b.dataset.paction.split("::");
    const p = igniteProjects.find((x) => x.id === id); if (!p) return;
    const a = (p.actions || [])[+idx]; if (!a) return;
    if (a.type === "url") { window.open(urlIn(a.target) || a.target, "_blank", "noopener"); return; }  // web links open straight from here
    igniteOpen(a);   // folder / vscode / app / cmd need Ignite's local launcher
  });
  $("#content").querySelectorAll("[data-pignite]").forEach((b) => b.onclick = () => igniteLaunch(b.dataset.pignite));
  $("#content").querySelectorAll("[data-ppin]").forEach((b) => b.onclick = async () => { if (await ignitePin(b.dataset.ppin, b.dataset.on === "1") && refresh) refresh(); });
}
async function renderProjects(c) {
  $("#content").innerHTML = `<div class="empty">Loading projects from Ignite…</div>`;
  let data; try { data = await fetch("/api/ignite-projects").then((r) => r.json()); } catch { data = { down: true, projects: [] }; }
  if (current !== "projects") return;   // user navigated away while the fetch was in flight
  igniteProjects = data.projects || [];
  const url = data.igniteUrl || "http://localhost:1234";
  $("#catPill").textContent = igniteProjects.length + " projects";
  const head = `<div class="pmbar">
      <span class="pmnote">Live from the Ignite panel · <code>${esc(url)}</code></span>
      <span class="pmbtns"><button class="btn" id="pmRefresh">↻ Refresh</button>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">🔥 Open Ignite ↗</a></span>
    </div>`;
  if (data.down) {
    $("#content").innerHTML = head + `<div class="empty">Ignite panel isn't responding at <code>${esc(url)}</code>.<br>Start it, then hit <b>Refresh</b> — or open it from the button above.</div>`;
    $("#pmRefresh").onclick = () => renderProjects(c); buildNav(); return;
  }
  const q = ($("#search").value || "").toLowerCase();
  let list = igniteProjects;
  if (q) list = list.filter((p) => (p.name + " " + (p.description || "") + " " + (p.actions || []).map((a) => (a.label || "") + " " + (a.target || "")).join(" ")).toLowerCase().includes(q));
  const pinned = list.filter((p) => p.ongoing), rest = list.filter((p) => !p.ongoing);
  const grid = (arr) => `<div class="pgrid">${arr.map(projectCard).join("")}</div>`;
  let html = head;
  if (!list.length) html += `<div class="empty">No projects${q ? " match your search" : " yet"}. Add them in the Ignite panel.</div>`;
  else {
    if (pinned.length) html += `<div class="sechead"><span>📌 Ongoing (pinned)</span><span class="line"></span></div>` + grid(pinned);
    if (rest.length) html += `<div class="sechead"><span>${pinned.length ? "Other projects" : "Projects"}</span><span class="line"></span></div>` + grid(rest);
  }
  $("#content").innerHTML = html;
  $("#pmRefresh").onclick = () => renderProjects(c);
  attachProjectHandlers(() => renderProjects(c));
  buildNav();   // refresh the sidebar count now that projects are loaded
}
// Home block: the pinned (ongoing) projects, filled in after Home renders.
async function loadHomeProjects() {
  const el = document.getElementById("hProjects"); if (!el) return;
  let data; try { data = await fetch("/api/ignite-projects").then((r) => r.json()); } catch { return; }
  if (!document.getElementById("hProjects")) return;   // navigated away
  igniteProjects = data.projects || igniteProjects;
  const url = data.igniteUrl || "http://localhost:1234";
  if (data.down) { el.innerHTML = `<div class="hsec">🔥 Projects</div><div class="hempty">Ignite panel offline — <a href="${esc(url)}" target="_blank" rel="noopener">open it ↗</a> to ignite projects.</div>`; return; }
  const pinned = (data.projects || []).filter((p) => p.ongoing);
  if (!pinned.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="hsec">🔥 Pinned projects</div><div class="pgrid">${pinned.map(projectCard).join("")}</div>`;
  attachProjectHandlers(() => loadHomeProjects());
}

/* ---------- add image / text modal (standard pages) ---------- */
$("#addImage").onclick = () => {
  const cid = current, isSubj = cid === "subjects", dflt = pageDefaultSection(cid);
  $("#imgModalTitle").textContent = "Add to " + (cat(cid) || {}).label;
  $("#iSubjLabel").textContent = isSubj ? "Subject" : "Carousel / section";
  $("#iSubject").placeholder = `carousel name (blank = ${dflt})`;
  $("#iAstroFields").style.display = "block";              // optional special message for any page
  $("#iLabelWrap").style.display = "none";                 // legacy "Label" field — not used anymore
  $("#iMaterialWrap").style.display = isSubj ? "flex" : "none";   // material parts are subjects-only
  $("#iFolder").checked = false; $("#iFile").webkitdirectory = false;
  $("#iSubject").value = ""; $("#iTitle").value = ""; $("#iLabel").value = ""; $("#iMessage").value = "";
  $("#iImportant").checked = false; $("#iMaterial").checked = false; $("#iFile").value = "";
  $("#subjectList").innerHTML = sectionsOf(cid).map((s) => `<option value="${esc(s)}">`).join("");
  showModal("imgModal", true);
};
$("#iFolder").onchange = () => { $("#iFile").webkitdirectory = $("#iFolder").checked; $("#iFile").value = ""; };
$("#imgCancel").onclick = () => showModal("imgModal", false);
const readFile = (f, asText) => new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; asText ? rd.readAsText(f) : rd.readAsDataURL(f); });
const isImgFile = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name);
const isTxtFile = (f) => f.type === "text/plain" || /\.txt$/i.test(f.name);
$("#imgSave").onclick = async () => {
  const cid = current, isSubj = cid === "subjects";
  let files = [...$("#iFile").files].filter((f) => isImgFile(f) || isTxtFile(f));   // folder import may include other types
  if (!files.length) { toast("Pick image / text file(s)"); return; }
  const section = $("#iSubject").value.trim() || pageDefaultSection(cid);
  const title = $("#iTitle").value.trim();
  const important = $("#iImportant").checked;
  const material = isSubj && $("#iMaterial").checked;
  const message = $("#iMessage").value.trim();
  showModal("imgModal", false);
  toast("Uploading " + files.length + " file(s)…");
  let added = 0;
  for (const f of files) {
    const isText = isTxtFile(f);
    try {
      const data = await readFile(f, isText);
      const r = await fetch("/api/upload-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data }) }).then((x) => x.json());
      if (!r.ok) { toast("Upload failed: " + (r.error || "")); continue; }
      const now = new Date().toISOString();
      const item = { id: uid(), category: cid, section, kind: isText ? "text" : "image", file: r.file, title: (files.length === 1 && title) ? title : f.name, important, body: isText ? data : "", created: now, updated: now };
      if (material) item.part = "material";
      if (message) item.message = message;
      db.items.push(item); added++;
    } catch { toast("Upload failed — is the server running?"); }
  }
  save(); render();
  toast("Added " + added + " to " + section);
};

/* ---------- Quick add: drag & drop anywhere → Quick items inbox (instant store) ----------
   pages.md: dropped item can be image / text file / link / plain text; titled or content-only;
   reviewed and transferred to a real page later via the Quick items inbox (moveSelected). */
const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || "").trim());
async function quickAddDrop(entries) {
  let added = 0;
  for (const e of entries) {
    const now = new Date().toISOString();
    if (e.file) {
      const f = e.file;
      if (isImgFile(f)) {
        try {
          const data = await readFile(f, false);
          const r = await fetch("/api/upload-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data }) }).then((x) => x.json());
          if (r.ok) { db.items.push({ id: uid(), category: "instant", section: "Inbox", kind: "image", file: r.file, title: f.name, body: "", created: now, updated: now }); added++; }
        } catch {}
      } else if (isTxtFile(f)) {
        try { const text = await readFile(f, true); db.items.push({ id: uid(), category: "instant", section: "Inbox", title: f.name.replace(/\.txt$/i, ""), body: String(text), created: now, updated: now }); added++; } catch {}
      }
    } else if (e.text && e.text.trim()) {
      const t = e.text.trim();
      const item = looksLikeUrl(t)
        ? { id: uid(), category: "instant", section: "Inbox", title: t, link: t, created: now, updated: now }
        : { id: uid(), category: "instant", section: "Inbox", title: "", body: t, created: now, updated: now };
      db.items.push(item); added++;
    }
  }
  if (added) { save(); if (current === "instant") render(); }
  toast(added ? `Quick-added ${added} item(s) → 📥 Quick items` : "Nothing to add");
}
(function setupQuickDrop() {
  const ov = document.createElement("div"); ov.id = "dropOverlay";
  ov.innerHTML = `<div class="dropbox">📥 Drop to Quick add<br><small>image · text file · link / text → Quick items inbox</small></div>`;
  document.body.appendChild(ov);
  const hasDrag = (dt) => dt && [...dt.types].some((t) => t === "Files" || t === "text/plain" || t === "text/uri-list");
  const modalOpen = () => !!document.querySelector(".modal.show");
  let depth = 0;
  window.addEventListener("dragenter", (e) => { if (modalOpen() || !hasDrag(e.dataTransfer)) return; depth++; ov.classList.add("show"); });
  window.addEventListener("dragover", (e) => { if (!modalOpen() && hasDrag(e.dataTransfer)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove("show"); });
  window.addEventListener("drop", (e) => {
    depth = 0; ov.classList.remove("show");
    if (modalOpen()) return;                       // let modal file inputs handle their own drops
    const dt = e.dataTransfer; if (!dt) return;
    e.preventDefault();
    const entries = [];
    if (dt.files && dt.files.length) for (const f of dt.files) entries.push({ file: f });
    else { const text = dt.getData("text/uri-list") || dt.getData("text/plain"); if (text) entries.push({ text }); }
    if (entries.length) quickAddDrop(entries);
  });
})();

/* ---------- add/edit link modal (standard pages → "LINKS" / "LINKS - {Category}" carousel) ----------
   Editing a link goes through HERE (not the generic item modal) so the URL is never dropped on rename. */
let editingLinkId = null;
function openLinkEditor(id) {
  const it = id ? db.items.find((x) => x.id === id) : null;
  const pageId = it ? it.category : current;
  if (!isStandard(pageId)) return;
  editingLinkId = it ? it.id : null;
  const catLinks = !!pageCfg(pageId).catLinks;
  $("#linkModalTitle").textContent = (it ? "Edit link · " : "Add link to ") + ((cat(pageId) || {}).label || "");
  $("#lCategoryWrap").style.display = catLinks ? "block" : "none";
  $("#lCategoryList").innerHTML = catLinks ? linkCategories(pageId).map((s) => `<option value="${esc(s)}">`).join("") : "";
  $("#lCategory").value = (it && /^LINKS - /.test(it.section || "")) ? it.section.slice(8) : "";
  $("#lLink").value = it ? (it.link || "") : "";
  $("#lLabel").value = it ? (it.title || "") : "";
  $("#lMessage").value = it ? (it.message || "") : "";
  $("#lReason").value = it ? (it.reason || "") : "";
  showModal("linkModal", true);
  setTimeout(() => ((catLinks && !it) ? $("#lCategory") : $("#lLink")).focus(), 50);
}
$("#addLink").onclick = () => openLinkEditor(null);
$("#linkCancel").onclick = () => showModal("linkModal", false);
$("#linkSave").onclick = () => {
  const link = $("#lLink").value.trim();
  if (!link) { toast("Enter a link (URL)"); return; }
  const now = new Date().toISOString();
  if (editingLinkId) {
    const t = db.items.find((x) => x.id === editingLinkId);
    if (!t) { showModal("linkModal", false); return; }
    t.link = link; t.title = $("#lLabel").value.trim();
    t.message = $("#lMessage").value.trim(); t.reason = $("#lReason").value.trim();
    if (pageCfg(t.category).catLinks) t.section = linkSection(t.category, $("#lCategory").value);  // move between LINKS sub-carousels
    t.updated = now;
    showModal("linkModal", false); save(); render(); toast("Link updated");
  } else {
    const sec = linkSection(current, $("#lCategory").value);
    db.items.push({
      id: uid(), category: current, section: sec,
      title: $("#lLabel").value.trim(), link,
      message: $("#lMessage").value.trim(), reason: $("#lReason").value.trim(),
      body: "", created: now, updated: now,
    });
    showModal("linkModal", false); save(); render(); toast("Added to " + sec);
  }
};

/* ================= Google Drive sync (independent; server proxies the Drive API) ================= */
let driveState = { configured: false, connected: false, email: null, lastSync: null };
async function refreshDriveStatus() {
  try { driveState = await fetch("/api/drive/status").then((r) => r.json()); } catch {}
  paintDrive();
  return driveState;
}
function paintDrive() {
  const st = $("#driveStatus"); if (!st) return;
  const conn = driveState.connected;
  $("#driveConnected").style.display = conn ? "block" : "none";
  $("#driveSetup").style.display = conn ? "none" : "block";
  if (conn) {
    const last = driveState.lastSync ? new Date(driveState.lastSync).toLocaleString() : "never";
    st.innerHTML = `Connected as <b>${esc(driveState.email || "—")}</b><br><small>Last sync: ${esc(last)}</small>`;
    st.className = "drivestatus ok";
  } else {
    st.textContent = driveState.configured ? "Credentials saved — click Connect to sign in." : "Not connected yet.";
    st.className = "drivestatus";
  }
  const auto = $("#dAuto"); if (auto) auto.checked = !!(db.settings && db.settings.driveAutoSync);
}
$("#driveBtn").onclick = () => { showModal("driveModal", true); refreshDriveStatus(); refreshDriveSpace(); };

const mbFmt = (b) => (Number(b || 0) / 1048576).toFixed(1) + " MB";
async function refreshDriveSpace() {
  const el = $("#spaceInfo"); if (!el) return;
  try {
    const s = await fetch("/api/drive/space").then((r) => r.json());
    el.innerHTML =
      `Local images: <b>${s.localCount}</b> (${mbFmt(s.localBytes)})<br>` +
      `On Drive, removable now: <b>${s.offloadable}</b> (${mbFmt(s.offloadableBytes)})<br>` +
      `<small>Drive cache: ${s.cacheCount} file(s), ${mbFmt(s.cacheBytes)} / ${mbFmt(s.cacheLimit)}</small>`;
    const btn = $("#dOffload"); if (btn) btn.disabled = !s.offloadable;
  } catch { el.textContent = "Could not read local usage."; }
}
// shared progress bar for sync + offload — polls /api/drive/progress while an op runs
let driveProgT = null;
function startDriveProgress(label) {
  const wrap = $("#driveProg"), bar = $("#driveProgBar"), lbl = $("#driveProgLbl");
  if (!wrap || !$("#driveModal").classList.contains("show")) return;   // no bar for background auto-sync
  wrap.style.display = "block"; bar.style.width = "0%"; lbl.textContent = label + "…";
  clearInterval(driveProgT);
  driveProgT = setInterval(async () => {
    try {
      const p = await fetch("/api/drive/progress").then((r) => r.json());
      if (p && p.total > 0) {
        const pct = Math.min(100, Math.round((p.done / p.total) * 100));
        bar.style.width = pct + "%";
        lbl.textContent = `${label}: ${p.done} / ${p.total} (${pct}%)`;
      }
    } catch {}
  }, 400);
}
function stopDriveProgress() {
  clearInterval(driveProgT); driveProgT = null;
  const wrap = $("#driveProg"), bar = $("#driveProgBar");
  if (bar) bar.style.width = "100%";
  if (wrap) setTimeout(() => { wrap.style.display = "none"; }, 700);
}

$("#dOffload").onclick = async () => {
  if (!driveState.connected) { toast("Connect Google Drive first"); return; }
  if (!confirm("Free up local space?\n\nThis deletes local image files that are already on Drive. Each is verified on Drive first, then removed locally; it will stream back from Drive when viewed. Make sure your last sync finished.")) return;
  const btn = $("#dOffload"); if (btn) btn.disabled = true;
  toast("Freeing space… verifying each image on Drive");
  startDriveProgress("Freeing space");
  try {
    const r = await fetch("/api/drive/offload", { method: "POST" }).then((x) => x.json());
    if (r.error) { toast("Offload error: " + r.error); }
    else {
      const extra = r.verifyFailed ? `, kept ${r.verifyFailed} (not verified)` : "";
      toast(`Freed ${mbFmt(r.freedBytes)} — removed ${r.removed} image(s)${extra}`);
    }
  } catch { toast("Offload failed — is the server running?"); }
  finally { stopDriveProgress(); refreshDriveSpace(); }
};
$("#driveCancel").onclick = () => showModal("driveModal", false);
$("#dConnect").onclick = async () => {
  const client_id = $("#dClientId").value.trim(), client_secret = $("#dClientSecret").value.trim();
  if (!client_id || !client_secret) { toast("Enter Client ID and secret"); return; }
  try {
    const r = await fetch("/api/drive/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id, client_secret }) }).then((x) => x.json());
    if (!r.ok) { toast("Config failed"); return; }
    window.open("/api/drive/connect", "_blank");        // Google consent tab
    toast("Consent opened — sign in, then return here");
    drivePoll();                                         // flip UI to connected once consent completes
  } catch { toast("Config failed — is the server running?"); }
};
let drivePollT = null;
function drivePoll() {
  let n = 0; clearInterval(drivePollT);
  drivePollT = setInterval(async () => { n++; await refreshDriveStatus(); if (driveState.connected || n > 40) { clearInterval(drivePollT); if (driveState.connected) toast("Drive connected ✓"); } }, 1500);
}
$("#dDisconnect").onclick = async () => {
  if (!confirm("Disconnect Google Drive? Files already in Drive stay; only the local link is forgotten.")) return;
  try { await fetch("/api/drive/disconnect", { method: "POST" }); } catch {}
  await refreshDriveStatus(); toast("Disconnected");
};
$("#dAuto").onchange = () => { db.settings.driveAutoSync = $("#dAuto").checked; save(); toast(db.settings.driveAutoSync ? "Auto-sync on" : "Auto-sync off"); };
$("#dSync").onclick = () => syncDrive(true);

let driveSyncing = false;
async function syncDrive(manual) {
  if (driveSyncing) return;
  if (!driveState.connected) { if (manual) toast("Connect Google Drive first"); return; }
  driveSyncing = true;
  if (manual) toast("Syncing to Drive…");
  startDriveProgress("Syncing");
  try {
    const r = await fetch("/api/drive/sync", { method: "POST" }).then((x) => x.json());
    if (r.busy) { if (manual) toast("A sync is already running…"); }
    else if (r.error) { toast("Sync error: " + r.error); }
    else {
      driveState.lastSync = r.lastSync; driveState.email = r.email || driveState.email; paintDrive();
      const parts = [];
      if (r.uploaded) parts.push(r.uploaded + " new");
      if (r.updated) parts.push(r.updated + " updated");
      if (r.moved) parts.push(r.moved + " moved");
      toast("Drive sync ✓ " + (parts.length ? "(" + parts.join(", ") + ")" : "(up to date)"));
      if ($("#driveModal").classList.contains("show")) refreshDriveSpace();
    }
  } catch { if (manual) toast("Sync failed — is the server running?"); }
  finally { driveSyncing = false; stopDriveProgress(); }
}

// called after each successful DB save; only fires when connected + auto-sync is on (debounced)
let autoSyncT = null;
function maybeAutoSyncDrive() {
  if (!(db.settings && db.settings.driveAutoSync) || !driveState.connected) return;
  clearTimeout(autoSyncT);
  autoSyncT = setTimeout(() => syncDrive(false), 6000);
}
refreshDriveStatus();

load();
