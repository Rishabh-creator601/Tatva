// Tatva Panel — zero-dependency Node.js server
// Serves the SPA in /public and a tiny JSON-file "DB" API with auto-backup.
// Run:  node server.js   (or double-click start.bat)  ->  http://localhost:4321

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const STORE = path.join(ROOT, "store");        // one portable folder: db + backups + images
const BACKUPS = path.join(STORE, "backups");
const IMAGES = path.join(STORE, "images");
const IMG_BACKUP = path.join(BACKUPS, "images");     // deleted images are moved here (strict backup), never hard-erased
const DB = path.join(STORE, "db.json");
const SEED = path.join(STORE, "seed.json");
const PORT = 4321;
const MAX_BACKUPS = 80;
const IGNITE = "http://localhost:1234";   // the Ignite panel — Project manager pulls its projects live

for (const d of [STORE, BACKUPS, IMAGES, IMG_BACKUP]) fs.mkdirSync(d, { recursive: true });

// If no db yet, copy the seed (first run).
if (!fs.existsSync(DB)) {
  if (fs.existsSync(SEED)) fs.copyFileSync(SEED, DB);
  else fs.writeFileSync(DB, JSON.stringify({ settings: { theme: "dark" }, categories: [], items: [] }, null, 2));
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

// rolling samples for /api/sysinfo deltas
let prevCpu = null, prevNet = null;
function cpuPercent() {
  const c = os.cpus(); let idle = 0, total = 0;
  for (const x of c) { for (const k in x.times) total += x.times[k]; idle += x.times.idle; }
  if (!prevCpu) { prevCpu = { idle, total }; return 0; }
  const di = idle - prevCpu.idle, dt = total - prevCpu.total; prevCpu = { idle, total };
  return dt > 0 ? Math.round(100 * (1 - di / dt)) : 0;
}
function diskInfo() {
  try {
    const s = fs.statfsSync(path.parse(ROOT).root);
    const total = s.blocks * s.bsize, free = s.bfree * s.bsize;
    return { used: total - free, total };
  } catch { return { used: 0, total: 0 }; }
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupAndWrite(json) {
  // backup the existing db before overwriting
  if (fs.existsSync(DB)) {
    fs.copyFileSync(DB, path.join(BACKUPS, `db-${ts()}.json`));
    // prune old backups
    const files = fs.readdirSync(BACKUPS).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUPS, files.shift()));
  }
  fs.writeFileSync(DB, JSON.stringify(json, null, 2));
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/db")) {
    if (req.method === "GET") {
      try { return sendJSON(res, 200, JSON.parse(fs.readFileSync(DB, "utf8"))); }
      catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 20e6) req.destroy(); });
      req.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (!json || typeof json !== "object" || !Array.isArray(json.items)) throw new Error("bad shape");
          backupAndWrite(json);
          return sendJSON(res, 200, { ok: true, saved: json.items.length });
        } catch (e) { return sendJSON(res, 400, { error: String(e) }); }
      });
      return;
    }
    res.writeHead(405); return res.end("method not allowed");
  }
  // export to Desktop/Tatva Exports as a per-page / per-carousel folder tree (see .claude/exports.md)
  //   images -> {page}/{carousel}/images/*           text -> {page}/{carousel}/{carousel}.txt
  //   links  -> {page}/LINKS/{category if avail}/links.txt
  // body: { category: "<id>"|"all", section?: "<carousel>" }  (section limits to one carousel)
  if (req.url.startsWith("/api/export") && !req.url.startsWith("/api/export-subjects") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let category = "all", section = null;
      try { const j = JSON.parse(body || "{}"); category = j.category || "all"; section = j.section || null; }
      catch { return sendJSON(res, 400, { error: "bad request" }); }
      try {
        const db = JSON.parse(fs.readFileSync(DB, "utf8"));
        const desk = [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "OneDrive", "Desktop")].find((d) => fs.existsSync(d)) || os.homedir();
        const root = path.join(desk, "Tatva Exports");
        fs.mkdirSync(root, { recursive: true });

        // strip Windows-illegal filename chars, collapse whitespace, trim trailing dots/spaces
        const safe = (s) => (String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "")) || "Untitled";
        const stripMd = (s) => String(s || "")
          .replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1")
          .split(/\r?\n/).map((ln) => ln
            .replace(/^\s*[-*]\s*\[( |x|X)\]\s+/, (m, g) => `[${g.toLowerCase() === "x" ? "x" : " "}] `)
            .replace(/^\s*[-*]\s+/, "")).join("\n");
        const isLinkItem = (i) => !!i.link || /^LINKS\b/.test(i.section || "");
        const isImgItem = (i) => i.kind === "image" || (!!i.file && !isLinkItem(i));
        const linkCat = (sec) => { const m = /^LINKS\s*-\s*(.+)$/.exec(sec || ""); return m ? m[1].trim() : ""; };

        const cats = category === "all" ? db.categories.map((c) => c.id) : [category];
        let files = 0, images = 0;
        for (const id of cats) {
          const c = db.categories.find((x) => x.id === id); if (!c) continue;
          const pageDir = path.join(root, safe(c.label));
          let items = db.items.filter((i) => i.category === id);
          if (section) items = items.filter((i) => (i.section || "") === section);
          const secs = [...new Set(items.map((i) => i.section || "General"))];
          for (const sec of secs) {
            const list = items.filter((i) => (i.section || "General") === sec);
            const imgs = list.filter(isImgItem);
            const links = list.filter(isLinkItem);
            const notes = list.filter((i) => !isImgItem(i) && !isLinkItem(i));

            // images -> {page}/{carousel}/images/
            if (imgs.length) {
              const dir = path.join(pageDir, safe(sec), "images");
              fs.mkdirSync(dir, { recursive: true });
              for (const i of imgs) {
                if (!i.file) continue;
                const src = path.join(IMAGES, i.file);
                if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dir, path.basename(i.file))); images++; }
              }
            }
            // text notes -> {page}/{carousel}/{carousel}.txt (one file, notes separated by NOTE markers)
            if (notes.length) {
              const dir = path.join(pageDir, safe(sec));
              fs.mkdirSync(dir, { recursive: true });
              let text = "";
              notes.forEach((i, n) => {
                const content = [i.title, i.body].map((x) => stripMd((x || "").trim())).filter(Boolean).join("\n");
                text += `<---- NOTE ${n + 1} ---->\n\n${content}\n`;
                if (i.message) text += `note message : ${stripMd(i.message)}\n`;
                text += "\n";
              });
              fs.writeFileSync(path.join(dir, safe(sec) + ".txt"), "﻿" + text, "utf8"); files++;
            }
            // links -> {page}/LINKS/{category if avail}/links.txt
            if (links.length) {
              const cn = linkCat(sec);
              const dir = cn ? path.join(pageDir, "LINKS", safe(cn)) : path.join(pageDir, "LINKS");
              fs.mkdirSync(dir, { recursive: true });
              let text = "";
              for (const i of links) {
                text += `title : ${stripMd((i.title || "").trim())}\n`;
                text += `link : ${i.link || ""}\n`;
                if (i.message) text += `message : ${stripMd(i.message)}\n`;
                text += "\n";
              }
              fs.writeFileSync(path.join(dir, "links.txt"), "﻿" + text, "utf8"); files++;
            }
          }
        }
        return sendJSON(res, 200, { ok: true, dir: root, files, images });
      } catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    });
    return;
  }

  // system info for the Home widget (CPU/RAM/disk + net throughput)
  if (req.url.startsWith("/api/sysinfo") && req.method === "GET") {
    const mem = { used: os.totalmem() - os.freemem(), total: os.totalmem() };
    const cpu = cpuPercent();
    const disk = diskInfo();
    const cmd = `powershell -NoProfile -Command "$s=Get-NetAdapterStatistics; '{0} {1}' -f (($s|Measure-Object ReceivedBytes -Sum).Sum),(($s|Measure-Object SentBytes -Sum).Sum)"`;
    exec(cmd, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      let net = { down: 0, up: 0 };
      if (!err) {
        const [rx, tx] = String(stdout).trim().split(/\s+/).map(Number);
        const now = Date.now();
        if (prevNet && Number.isFinite(rx) && Number.isFinite(tx)) {
          const dt = (now - prevNet.t) / 1000;
          if (dt > 0) net = { down: Math.max(0, (rx - prevNet.rx) / dt), up: Math.max(0, (tx - prevNet.tx) / dt) };
        }
        if (Number.isFinite(rx)) prevNet = { rx, tx, t: now };
      }
      sendJSON(res, 200, { cpu, mem, disk, net });
    });
    return;
  }

  // ---- Project manager: proxy to the Ignite panel (localhost:1234) ----
  // Server-to-server so the browser hits no CORS, and it works whenever Ignite is running.
  //   GET  /api/ignite-projects        -> Ignite's project list (or {projects:[],down:true})
  //   POST /api/ignite-launch {id}     -> fire all of a project's actions ("Ignite")
  //   POST /api/ignite-open   {action} -> open a single action
  //   POST /api/ignite-pin    {id,ongoing} -> set a project's ongoing flag (pin/unpin)
  if (req.url.startsWith("/api/ignite-projects") && req.method === "GET") {
    fetch(IGNITE + "/api/projects", { signal: AbortSignal.timeout(4000) })
      .then((r) => r.json())
      .then((j) => sendJSON(res, 200, { projects: (j && j.projects) || [], igniteUrl: IGNITE }))
      .catch((e) => sendJSON(res, 200, { projects: [], down: true, igniteUrl: IGNITE, error: String(e) }));
    return;
  }
  if ((req.url.startsWith("/api/ignite-launch") || req.url.startsWith("/api/ignite-open")) && req.method === "POST") {
    const upstream = req.url.startsWith("/api/ignite-launch") ? "/api/launch" : "/api/open";
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      fetch(IGNITE + upstream, { method: "POST", headers: { "Content-Type": "application/json" }, body: body || "{}", signal: AbortSignal.timeout(8000) })
        .then(async (r) => sendJSON(res, r.status, await r.json().catch(() => ({ ok: r.ok }))))
        .catch((e) => sendJSON(res, 502, { error: "Ignite unreachable", detail: String(e) }));
    });
    return;
  }
  if (req.url.startsWith("/api/ignite-pin") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", async () => {
      let id, ongoing;
      try { const j = JSON.parse(body || "{}"); id = j.id; ongoing = !!j.ongoing; } catch { return sendJSON(res, 400, { error: "bad request" }); }
      try {
        const data = await fetch(IGNITE + "/api/projects", { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
        const projects = (data && data.projects) || [];
        const p = projects.find((x) => x.id === id);
        if (!p) return sendJSON(res, 404, { error: "project not found" });
        p.ongoing = ongoing;
        const put = await fetch(IGNITE + "/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projects }), signal: AbortSignal.timeout(6000) });
        return sendJSON(res, put.status, await put.json().catch(() => ({ ok: put.ok })));
      } catch (e) { return sendJSON(res, 502, { error: "Ignite unreachable", detail: String(e) }); }
    });
    return;
  }

  // upload an image (or text) file for Subjects -> store/images
  if (req.url.startsWith("/api/upload-image") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 30e6) req.destroy(); });
    req.on("end", () => {
      let name, data;
      try { const j = JSON.parse(body); name = path.basename(j.name || ""); data = String(j.data || ""); } catch { return sendJSON(res, 400, { error: "bad request" }); }
      const m = data.match(/^data:([^;]+);base64,(.*)$/s);
      const buf = m ? Buffer.from(m[2], "base64") : Buffer.from(data, "utf8");
      const ext = path.extname(name) || "";
      const base = (path.basename(name, ext).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40)) || "img";
      let fname = base + ext, n = 1;
      while (fs.existsSync(path.join(IMAGES, fname))) fname = base + "-" + (n++) + ext;
      try { fs.writeFileSync(path.join(IMAGES, fname), buf); return sendJSON(res, 200, { ok: true, file: fname }); }
      catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    });
    return;
  }

  // rename an image file
  if (req.url.startsWith("/api/rename-image") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let oldN, newN;
      try { const j = JSON.parse(body); oldN = path.basename(j.old || ""); newN = path.basename(j.new || ""); } catch { return sendJSON(res, 400, { error: "bad request" }); }
      const src = path.join(IMAGES, oldN), dst = path.join(IMAGES, newN);
      if (!src.startsWith(IMAGES) || !dst.startsWith(IMAGES) || !newN) return sendJSON(res, 400, { error: "bad name" });
      if (!fs.existsSync(src)) return sendJSON(res, 404, { error: "not found" });
      if (fs.existsSync(dst)) return sendJSON(res, 400, { error: "target exists" });
      try { fs.renameSync(src, dst); return sendJSON(res, 200, { ok: true, file: newN }); }
      catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    });
    return;
  }

  // delete an image: move it to backups/images (strict backup) instead of erasing — recoverable
  if (req.url.startsWith("/api/delete-image") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let name; try { name = path.basename(JSON.parse(body).file || ""); } catch { return sendJSON(res, 400, { error: "bad request" }); }
      const f = path.join(IMAGES, name);
      if (!f.startsWith(IMAGES)) return sendJSON(res, 400, { error: "bad name" });
      try {
        if (fs.existsSync(f)) {
          let dst = path.join(IMG_BACKUP, name), n = 1;
          while (fs.existsSync(dst)) { const e = path.extname(name); dst = path.join(IMG_BACKUP, path.basename(name, e) + "-" + (n++) + e); }
          fs.renameSync(f, dst);
        }
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    });
    return;
  }

  // export subjects: copy actual image/text files into Desktop/Tatva Exports/Subjects/<subject>/
  if (req.url.startsWith("/api/export-subjects") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let which = "all", catId = "subjects";
      try { const j = JSON.parse(body || "{}"); which = j.subject || "all"; catId = j.category || "subjects"; } catch {}
      try {
        const db = JSON.parse(fs.readFileSync(DB, "utf8"));
        const desk = [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "OneDrive", "Desktop")].find((d) => fs.existsSync(d)) || os.homedir();
        const folder = catId === "astrology" ? "Astrology Images" : "Subjects";
        const base = path.join(desk, "Tatva Exports", folder);
        fs.mkdirSync(base, { recursive: true });
        const items = db.items.filter((i) => i.category === catId && i.file && (which === "all" || (i.section || "Instant") === which));
        const subjects = new Set(); let copied = 0;
        for (const i of items) {
          const subj = (i.section || "Instant").replace(/[^a-z0-9 _-]/gi, "").trim() || "Instant";
          const part = i.part === "material" ? "Material" : "";
          const dir = path.join(base, subj, part);
          fs.mkdirSync(dir, { recursive: true }); subjects.add(subj);
          const src = path.join(IMAGES, i.file);
          if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dir, i.file)); copied++; }
        }
        return sendJSON(res, 200, { ok: true, dir: base, subjects: [...subjects], copied });
      } catch (e) { return sendJSON(res, 500, { error: String(e) }); }
    });
    return;
  }

  // serve uploaded images
  if (req.url.startsWith("/images/")) {
    const name = path.basename(decodeURIComponent(req.url.split("?")[0]));
    const f = path.join(IMAGES, name);
    if (!f.startsWith(IMAGES)) { res.writeHead(403); return res.end("forbidden"); }
    return fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  Tatva Panel running →  http://localhost:${PORT}`);
  console.log(`  DB:      ${DB}`);
  console.log(`  Backups: ${BACKUPS}  (auto, last ${MAX_BACKUPS})\n`);
});
