# 02 — Code Structure

## Repository layout

```
D:\Tatva\
├── CLAUDE.md                  # instructions for AI assistants (source of truth for conventions)
├── plan_tatva/                # << this documentation folder
│
├── panel/                     # ★ THE PANEL — the actively developed app
│   ├── server.js              # zero-dep Node http server (~324 lines)
│   ├── start.bat              # foreground launcher (shows console)
│   ├── start-hidden.vbs       # launches node hidden, no window
│   ├── public/                # the SPA (served static)
│   │   ├── index.html         # DOM scaffold: sidebar + main + modals + lightbox (~199 lines)
│   │   ├── app.js             # the ENTIRE SPA, vanilla JS (~1,183 lines)
│   │   └── style.css          # theming + layout (~338 lines)
│   ├── data/                  # one-off Node scripts that rewrite db.json (the "admin UI")
│   │   ├── migrate-to-store.js, seed-build.js
│   │   ├── merge-cmd*.js, add-*-links.js, cmd*-pages.js
│   │   ├── repair-encoding.js, repair-arrows.js   # fix mojibake
│   │   └── import-life-lessons.js                  # latest import
│   └── store/                 # ★ THE PORTABLE DATA FOLDER (see 03-file-management.md)
│       ├── db.json            # the whole database
│       ├── seed.json          # first-run seed copy
│       ├── backups/           # auto, last 80 db-*.json  (+ backups/images for deletes)
│       └── images/            # uploaded image & text files (552+ files)
│
│   # NOTE: old standalone dashboards (index.html, short-notes/, astrology/,
│   #       personality.html, commands.txt) were REMOVED 2026-06-27 — superseded
│   #       by the Panel; content lives in db.json. Backup: Desktop/tatva-legacy-backup-*.zip
│
└── (STILL-ACTIVE markdown — NOT the Panel, NOT legacy)
    ├── todo/                    # real to-do system; markdown = source of truth (Obsidian/Dataview)
    ├── personality/lostpersonality.md   # "PERSONALITY ADD" traits file
    └── archive/settings.txt     # manifest for the todo/ system
```

## Server — `panel/server.js`

A single `http.createServer` handler. Routes are matched with
`req.url.startsWith(...)` **in order** — so **prefix collisions matter**
(e.g. `/api/export-subjects` must be guarded against the `/api/export` handler).

| Method & route | Purpose |
|----------------|---------|
| `GET  /api/db` | return the whole `db.json` |
| `POST /api/db` | validate shape, **backup old db**, then overwrite (the only write path for the SPA) |
| `POST /api/export` | write per-page / per-carousel `.txt` + image tree to `Desktop/Tatva Exports/` |
| `GET  /api/sysinfo` | CPU% (delta), RAM (`os`), disk (`statfsSync`), net throughput (PowerShell diff) |
| `POST /api/upload-image` | save base64 file into `store/images/` (sanitized, deduped name) |
| `POST /api/rename-image` | rename a file in `store/images/` |
| `POST /api/delete-image` | **move** file to `backups/images/` (recoverable, never hard-erased) |
| `POST /api/export-subjects` | legacy images-only export (still present, client no longer calls it) |
| `GET  /images/*` | serve an uploaded file (path-traversal guarded, `no-store`) |
| `GET  /*` | `serveStatic` from `public/` |

Key helpers: `backupAndWrite()` (copy then prune to `MAX_BACKUPS=80`), `cpuPercent()` /
`diskInfo()` (sysinfo deltas), `sendJSON()`, `serveStatic()` (with `PUBLIC` prefix guard).

## Client — `panel/public/app.js`

One file, no modules. Loads the whole DB into memory (`db`) once, then **every mutation
calls `save()`** which re-POSTs the entire DB (debounced ~350 ms).

**Lifecycle**
- `load()` — fetch `/api/db`, migrate legacy fields, `applyTheme`, pick `current` category, `render()`
- `save(immediate?)` — debounced whole-DB POST; toasts "Saved ✓ (backup made)"

**Render hub — `render()`** dispatches by the current category:
- `home` -> `renderHome()` (clock, weather, quotes, pins, system stats, task counts)
- `subjects` -> `renderSubjects()` (image carousels)
- standard pages (`isStandard`) -> `renderStandard()` (carousels of images / text / notes / links)
- `todo` -> special Important / sections / **Missed** grouping
- everything else -> generic section cards via `cardHTML()`

**Page config — `PAGES`** decides render mode per category:
```js
subjects, astrology, shortnotes, personality, programming, college  // standard:true
// astrology/programming/college also catLinks:true (named LINKS - {Category} carousels)
```

**Carousel meta** (`db.settings.carousels[category/section]`): per-carousel
`important`, `home`, `msg`, `color`, `order` — managed by the `car*()` helpers.

**Other concerns:** `mdRender()` safe markdown-ish + checkboxes, `slideHTML()`/`cardHTML()`
card builders, modal/editor functions, `doExport()`, `pollSys()`, Home widgets
(weather/quotes/clock), and `localStorage` pins (`lsGet`/`savePins`/`togglePin`).

## DOM scaffold — `public/index.html`

Static shell only: `#nav` sidebar, `#content` main area, the add/edit **modals**, the
image **lightbox**, and the **#toast**. All content is injected by `app.js`.
