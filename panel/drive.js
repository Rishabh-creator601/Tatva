// Tatva Panel — independent Google Drive sync (zero dependencies, Node stdlib only).
// Mirrors the Panel's data into  Drive:/Tatva/sync/  as ONE categorized copy of each thing,
// and MOVES anything deleted in the Panel into  Drive:/Tatva/deleted/  (never erased).
// The local store/backups/ folder is never synced. No timestamped/backup copies are made in Drive.
//
// Auth is OAuth2 (loopback flow) with a Desktop-app client the user creates once in Google Cloud.
// Scope: drive.file  — the app can only see/manage the files it creates (the whole Tatva/ tree).
//
// State files (all live in store/, portable with the rest of the data):
//   drive-config.json  { client_id, client_secret }
//   drive-token.json   { refresh_token, email }
//   drive-sync.json    manifest (folder-id cache + per-item drive ids + hashes)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REDIRECT_URI = "http://localhost:4321/api/drive/callback";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const LOGIN_HINT = "rishabhagarwal1028@gmail.com";
const AUTH_EP = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_EP = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

let STORE = null, CONFIG_F = null, TOKEN_F = null, MANIFEST_F = null;
function init(storeDir) {
  STORE = storeDir;
  CONFIG_F = path.join(STORE, "drive-config.json");
  TOKEN_F = path.join(STORE, "drive-token.json");
  MANIFEST_F = path.join(STORE, "drive-sync.json");
}

/* ---------- tiny JSON file helpers ---------- */
function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } }
function writeJson(f, obj) { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }
function rmFile(f) { try { fs.unlinkSync(f); } catch {} }

function getConfig() { return readJson(CONFIG_F, null); }
function setConfig(client_id, client_secret) { writeJson(CONFIG_F, { client_id: String(client_id || "").trim(), client_secret: String(client_secret || "").trim() }); }
function getToken() { return readJson(TOKEN_F, null); }
function isConfigured() { const c = getConfig(); return !!(c && c.client_id && c.client_secret); }
function isConnected() { const t = getToken(); return !!(t && t.refresh_token); }

/* ---------- OAuth ---------- */
function authUrl() {
  const c = getConfig();
  if (!c || !c.client_id) throw new Error("Drive not configured (missing client id/secret)");
  const p = new URLSearchParams({
    client_id: c.client_id, redirect_uri: REDIRECT_URI, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", login_hint: LOGIN_HINT,
  });
  return `${AUTH_EP}?${p.toString()}`;
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN_EP, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("OAuth token error: " + (j.error_description || j.error || r.status));
  return j;
}

async function exchangeCode(code) {
  const c = getConfig();
  if (!c) throw new Error("Drive not configured");
  const j = await tokenRequest({
    code, client_id: c.client_id, client_secret: c.client_secret,
    redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
  });
  if (!j.refresh_token) throw new Error("No refresh_token returned — re-consent with prompt=consent");
  const tok = { refresh_token: j.refresh_token };
  cachedAccess = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  writeJson(TOKEN_F, tok);
  try { tok.email = await whoAmI(); writeJson(TOKEN_F, tok); } catch {}
  return tok;
}

let cachedAccess = null;   // { token, exp }
async function accessToken() {
  if (cachedAccess && cachedAccess.exp > Date.now()) return cachedAccess.token;
  const c = getConfig(), t = getToken();
  if (!c) throw new Error("Drive not configured");
  if (!t || !t.refresh_token) throw new Error("Drive not connected");
  const j = await tokenRequest({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: t.refresh_token, grant_type: "refresh_token",
  });
  cachedAccess = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
  return cachedAccess.token;
}

function disconnect() { rmFile(TOKEN_F); rmFile(MANIFEST_F); cachedAccess = null; }

/* ---------- Drive REST helpers ---------- */
async function driveFetch(url, opts = {}) {
  const tok = await accessToken();
  const headers = Object.assign({ Authorization: "Bearer " + tok }, opts.headers || {});
  const r = await fetch(url, Object.assign({}, opts, { headers }));
  const txt = await r.text();
  let j; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
  if (!r.ok) throw new Error(`Drive ${r.status}: ${(j.error && j.error.message) || txt || "request failed"}`);
  return j;
}
async function whoAmI() { const j = await driveFetch(`${API}/about?fields=user`); return j.user && j.user.emailAddress; }

const qEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function ensureFolder(name, parentId) {
  const q = `name='${qEsc(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const j = await driveFetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&spaces=drive`);
  if (j.files && j.files.length) return j.files[0].id;
  const c = await driveFetch(`${API}/files?fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  return c.id;
}
async function uploadFile(name, parentId, bytes, mime) {
  const boundary = "tatva-" + crypto.randomBytes(8).toString("hex");
  const meta = JSON.stringify({ name, parents: [parentId] });
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, "utf8");
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const j = await driveFetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([pre, bytes, post]),
  });
  return j.id;
}
async function updateContent(fileId, bytes, mime) {
  await driveFetch(`${UPLOAD}/${fileId}?uploadType=media&fields=id`, {
    method: "PATCH", headers: { "Content-Type": mime }, body: bytes,
  });
}
// rename and/or reparent in one PATCH
async function patchMeta(fileId, { name, addParent, removeParent } = {}) {
  const p = new URLSearchParams({ fields: "id" });
  if (addParent) p.set("addParents", addParent);
  if (removeParent) p.set("removeParents", removeParent);
  await driveFetch(`${API}/files/${fileId}?${p.toString()}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
}

/* ---------- categorized representation (mirrors /api/export naming) ---------- */
const EXT_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};
const safe = (s) => (String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "")) || "Untitled";
const shortId = (id) => String(id).replace(/[^a-z0-9]/gi, "").slice(-8) || "x";

// Build a readable .md for a non-file item (note / link / goal). ASCII only (repo mojibake rule).
function recordMd(i, pageLabel) {
  const lines = [];
  if (i.title) lines.push("# " + i.title, "");
  if (i.link) lines.push("link: " + i.link);
  if (i.message) lines.push("message: " + i.message);
  if (i.reason) lines.push("reason: " + i.reason);
  if (i.body) { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); lines.push(i.body); }
  lines.push("", "---", `category: ${pageLabel} / ${i.section || "General"}`, `updated: ${i.updated || ""}`);
  return lines.join("\n") + "\n";
}

// Descriptor per item: { relDir, name, relPath, mime, source:{file}|{text}, hash }.
// hash is computed WITHOUT touching disk: store/images/ files are immutable (uploads get unique
// names, renames change item.file), so the filename identifies the content -> steady-state syncs
// read zero image bytes; a file is only read when it actually has to be uploaded/updated.
function describe(i, pageLabel, imagesDir) {
  const section = safe(i.section || "General");
  const relDir = `${safe(pageLabel)}/${section}`;
  if (i.file) {
    const ext = path.extname(i.file) || "";
    const base = safe((i.title && i.title !== i.file) ? path.basename(i.title, ext) : path.basename(i.file, ext)).slice(0, 60);
    const name = `${base}__${shortId(i.id)}${ext}`;
    return { relDir, name, relPath: `${relDir}/${name}`, mime: EXT_MIME[ext.toLowerCase()] || "application/octet-stream", source: { file: path.join(imagesDir, i.file) }, hash: "f:" + i.file };
  }
  const text = recordMd(i, pageLabel);
  const name = `${safe(i.title || "note").slice(0, 60)}__${shortId(i.id)}.md`;
  return { relDir, name, relPath: `${relDir}/${name}`, mime: EXT_MIME[".md"], source: { text }, hash: hashBuf(Buffer.from(text, "utf8")) };
}

function materialize(source) {
  if (source.text != null) return Buffer.from(source.text, "utf8");
  return fs.readFileSync(source.file);   // image / text file bytes
}
const hashBuf = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

/* ---------- manifest ---------- */
function blankManifest() { return { meta: {}, folders: { sync: {}, deleted: {} }, items: {}, db: null, email: null, lastSync: null }; }
function loadManifest() { const m = readJson(MANIFEST_F, null) || blankManifest(); m.folders = m.folders || { sync: {}, deleted: {} }; m.folders.sync = m.folders.sync || {}; m.folders.deleted = m.folders.deleted || {}; m.items = m.items || {}; m.meta = m.meta || {}; return m; }

/* ---------- live progress (polled by the client for the progress bars) ---------- */
let progress = { active: false, phase: null, done: 0, total: 0 };
function getProgress() { return progress; }

/* ---------- sync engine ---------- */
let syncing = false;
// ensure a nested folder path (relDir like "Page/Carousel") under the sync or deleted root; cache ids.
async function ensurePath(man, which, relDir) {
  const cache = man.folders[which];
  const rootId = which === "sync" ? man.meta.syncRootId : man.meta.deletedRootId;
  if (!relDir) return rootId;
  if (cache[relDir]) return cache[relDir];
  const parts = relDir.split("/");
  let parent = rootId, cum = "";
  for (const part of parts) {
    cum = cum ? cum + "/" + part : part;
    if (!cache[cum]) cache[cum] = await ensureFolder(part, parent);
    parent = cache[cum];
  }
  return parent;
}

async function sync(db, imagesDir) {
  if (!isConnected()) throw new Error("Drive not connected");
  if (syncing) return { busy: true };
  syncing = true;
  progress = { active: true, phase: "sync", done: 0, total: 0 };
  const counts = { uploaded: 0, updated: 0, moved: 0, skipped: 0, deleted: 0 };
  try {
    const man = loadManifest();
    // roots
    man.meta.tatvaId = man.meta.tatvaId || await ensureFolder("Tatva", "root");
    man.meta.syncRootId = man.meta.syncRootId || await ensureFolder("sync", man.meta.tatvaId);
    man.meta.deletedRootId = man.meta.deletedRootId || await ensureFolder("deleted", man.meta.tatvaId);

    // remember the connected account (self-heals if the first lookup happened before the API was enabled)
    { const t = getToken(); if (t && t.email) man.email = t.email; }
    if (!man.email) { try { man.email = await whoAmI(); const t = getToken(); if (t) { t.email = man.email; writeJson(TOKEN_F, t); } } catch {} }

    const labelOf = {}; for (const c of (db.categories || [])) labelOf[c.id] = c.label || c.id;

    // ---- db.json: single authoritative copy at sync root (never moved to deleted) ----
    {
      const bytes = Buffer.from(JSON.stringify(db, null, 2), "utf8"), h = hashBuf(bytes);
      if (!man.db || !man.db.driveId) { man.db = { driveId: await uploadFile("db.json", man.meta.syncRootId, bytes, "application/json"), hash: h }; counts.uploaded++; }
      else if (man.db.hash !== h) { await updateContent(man.db.driveId, bytes, "application/json"); man.db.hash = h; counts.updated++; }
      else counts.skipped++;
    }

    // ---- per-item categorized files ----
    const items = (db.items || []).filter((i) => i && i.id && labelOf[i.category] !== undefined);
    progress.total = items.length;
    const seen = new Set();
    for (const i of items) {
      progress.done++;
      seen.add(i.id);
      let d;
      try { d = describe(i, labelOf[i.category], imagesDir); } catch { counts.skipped++; continue; }
      const h = d.hash;
      const prev = man.items[i.id];
      if (!prev) {
        let bytes; try { bytes = materialize(d.source); } catch { counts.skipped++; continue; }   // e.g. image file missing on disk
        const folderId = await ensurePath(man, "sync", d.relDir);
        const driveId = await uploadFile(d.name, folderId, bytes, d.mime);
        man.items[i.id] = { driveId, hash: h, relPath: d.relPath }; counts.uploaded++;
      } else {
        // moved carousel/page or renamed -> reparent/rename in place (still one copy)
        if (prev.relPath !== d.relPath) {
          const oldDir = path.posix.dirname(prev.relPath), newDir = d.relDir;
          const oldFolder = man.folders.sync[oldDir === "." ? "" : oldDir] || man.meta.syncRootId;
          const newFolder = await ensurePath(man, "sync", newDir);
          const nameChanged = path.posix.basename(prev.relPath) !== d.name;
          await patchMeta(prev.driveId, { name: nameChanged ? d.name : undefined, addParent: newFolder, removeParent: oldFolder });
          prev.relPath = d.relPath; counts.moved++;
        }
        if (prev.hash !== h) {
          let bytes; try { bytes = materialize(d.source); } catch { counts.skipped++; continue; }
          await updateContent(prev.driveId, bytes, d.mime); prev.hash = h; counts.updated++;
        } else counts.skipped++;
      }
    }

    // ---- deletions: item gone from db -> MOVE its Drive file into deleted/ (preserved) ----
    for (const id of Object.keys(man.items)) {
      if (seen.has(id)) continue;
      const rec = man.items[id];
      try {
        const relDir = path.posix.dirname(rec.relPath), fname = path.posix.basename(rec.relPath);
        const oldFolder = man.folders.sync[relDir === "." ? "" : relDir] || man.meta.syncRootId;
        const delFolder = await ensurePath(man, "deleted", relDir === "." ? "" : relDir);
        await patchMeta(rec.driveId, { addParent: delFolder, removeParent: oldFolder });
        counts.moved++; counts.deleted++;
      } catch { /* leave manifest entry so we retry next sync */ continue; }
      delete man.items[id];
    }

    const t = getToken();
    man.email = (t && t.email) || man.email;
    man.lastSync = new Date().toISOString();
    writeJson(MANIFEST_F, man);
    return Object.assign(counts, { email: man.email, lastSync: man.lastSync });
  } finally { syncing = false; progress.active = false; }
}

function status() {
  const t = getToken(), man = readJson(MANIFEST_F, null);
  return {
    configured: isConfigured(),
    connected: isConnected(),
    email: (t && t.email) || (man && man.email) || null,
    lastSync: (man && man.lastSync) || null,
  };
}

/* ---------- offload: keep bytes only in Drive, stream them back on demand ----------
   The manifest maps each image item to a Drive file id, and a file item's hash is
   "f:<filename>" (filenames are immutable), so filename -> driveId is a lookup.       */

// filename -> Drive file id, from the manifest (null if this image isn't on Drive).
function driveIdForFile(name) {
  const man = readJson(MANIFEST_F, null);
  if (!man || !man.items) return null;
  const want = "f:" + name;
  for (const id in man.items) {
    const it = man.items[id];
    if (it && it.driveId && it.hash === want) return it.driveId;
  }
  return null;
}

// map of every image filename known to be on Drive -> its driveId.
function driveImageMap() {
  const man = readJson(MANIFEST_F, null);
  const map = new Map();
  if (man && man.items) for (const id in man.items) {
    const it = man.items[id];
    if (it && it.driveId && it.hash && it.hash.startsWith("f:")) map.set(it.hash.slice(2), it.driveId);
  }
  return map;
}

// binary download of a Drive file's content (alt=media) -> Buffer.
async function downloadMedia(driveId) {
  const tok = await accessToken();
  const r = await fetch(`${API}/files/${driveId}?alt=media`, { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Drive download ${r.status}: ${(t || "").slice(0, 200)}`); }
  return Buffer.from(await r.arrayBuffer());
}

// Local-usage report for the "Free up space" UI (does not touch Drive).
function spaceInfo(imagesDir) {
  const onDrive = driveImageMap();
  let localCount = 0, localBytes = 0, offloadable = 0, offloadableBytes = 0;
  let files = []; try { files = fs.readdirSync(imagesDir); } catch {}
  for (const f of files) {
    let st; try { st = fs.statSync(path.join(imagesDir, f)); } catch { continue; }
    if (!st.isFile()) continue;
    localCount++; localBytes += st.size;
    if (onDrive.has(f)) { offloadable++; offloadableBytes += st.size; }
  }
  return { localCount, localBytes, offloadable, offloadableBytes, onDriveCount: onDrive.size };
}

// Delete local originals that are confirmed present (not trashed) on Drive.
// Verifies each file on Drive BEFORE removing the local copy, so nothing is lost
// if the manifest is stale. New/unsynced images (not in the manifest) are untouched.
async function offload(imagesDir) {
  if (!isConnected()) throw new Error("Drive not connected");
  const map = driveImageMap();
  progress = { active: true, phase: "offload", done: 0, total: map.size };
  let removed = 0, freedBytes = 0, kept = 0, verifyFailed = 0, notLocal = 0;
  try {
    for (const [file, driveId] of map) {
      progress.done++;
      const local = path.join(imagesDir, file);
      let stat; try { stat = fs.statSync(local); } catch { notLocal++; continue; }   // already offloaded / never local
      let ok = false;
      try { const meta = await driveFetch(`${API}/files/${driveId}?fields=id,trashed`); ok = !!(meta && meta.id && !meta.trashed); } catch { ok = false; }
      if (!ok) { verifyFailed++; kept++; continue; }
      try { fs.unlinkSync(local); removed++; freedBytes += stat.size; } catch { kept++; }
    }
  } finally { progress.active = false; }
  return { removed, freedBytes, kept, verifyFailed, notLocal };
}

module.exports = { init, getConfig, setConfig, isConfigured, isConnected, authUrl, exchangeCode, disconnect, sync, status, driveIdForFile, downloadMedia, spaceInfo, offload, getProgress };
