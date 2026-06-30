# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`D:\Tatva` is a personal knowledge/dashboard system for a single user, on Windows. It has two parallel parts:

1. **The Panel** (`panel/`) — the primary, actively-developed app: a local web app (Node + vanilla JS) with a file-based JSON "DB". This is where almost all work happens.
2. **Legacy standalone dashboards** — REMOVED. The old self-contained HTML dashboards (`index.html` home menu + `short-notes/`, `astrology/`, `personality/personality.html`, `commands.txt`) were superseded by the Panel and deleted on 2026-06-27. Their content already lives in the Panel (e.g. `shortnotes`/`astrology` categories in `db.json`). A zip backup was saved to the Desktop (`tatva-legacy-backup-<timestamp>.zip`).

   Still-active markdown (NOT legacy, do not move/delete): the **`todo/`** folder (your real to-do system — markdown is source of truth; Obsidian Dataview queries reference `todo/...` paths) and **`personality/lostpersonality.md`** (the "PERSONALITY ADD" traits file). `archive/settings.txt` is the manifest for the `todo/` system.

There is no build system, no package manager, no dependencies, and no test suite. The Panel runs on Node's stdlib only.

## Running the Panel

```bash
cd panel && node server.js      # serves http://localhost:4321
```
Also launchable via `panel/start.bat` or the Desktop shortcut `Tatva Panel.bat` (starts the server minimized if not already running, then opens the browser).

Checks (there are no tests/linters):
```bash
node -c server.js               # syntax-check the server
node -c public/app.js           # syntax-check the SPA

```








**Restart rules (important):**
- Editing `server.js` requires a **restart** — Node does not hot-reload. A start that prints `EADDRINUSE` means a previous instance is still bound to 4321; kill it first. On Windows: find the PID via `Get-NetTCPConnection -LocalPort 4321 -State Listen` and `Stop-Process -Id <pid> -Force`.
- Editing anything in `public/` (`index.html`, `app.js`, `style.css`) does **not** need a restart. Static files are served with `Cache-Control: no-store`, but browsers may still cache — do a **hard refresh (Ctrl+Shift+R)** to pick up changes.

## Panel architecture

- **`panel/server.js`** — zero-dependency Node `http` server. Serves `public/` and a small REST API. Routes are matched with `req.url.startsWith("/api/...")` in order — **prefix collisions matter** (e.g. `/api/export-subjects` must be guarded against the `/api/export` handler). Endpoints: `GET|POST /api/db`, `GET /api/sysinfo` (CPU/RAM via `os`, disk via `fs.statfsSync`, net throughput by shelling to PowerShell `Get-NetAdapterStatistics` and diffing samples), `POST /api/export` (writes per-category `.txt` to Desktop), `POST /api/export-subjects` (copies image files to Desktop), `POST /api/upload-image|rename-image|delete-image`, `GET /images/*`.
- **`public/app.js`** — the entire SPA (one file, vanilla JS, no framework). The client loads the whole DB into memory; **every mutation re-POSTs the entire DB** to `/api/db` (debounced ~350ms), and the server backs up then overwrites. `render()` is the hub: it special-cases the current category — `home`, `subjects`, `astrology`, `todo` each have a dedicated renderer; standard carousel pages (`subjects`, `astrology`, `shortnotes`, `links`, `programming`, `college` — see `PAGES` in `app.js` and `.claude/pages.md`) render as carousels; `links` changes card layout; everything else is generic section cards.
- **`public/style.css` / `index.html`** — styling and DOM scaffold (sidebar + main + modals + lightbox). Dark/light theme via `data-theme` on `<html>`.

### Data model (`store/db.json`)
`{ settings, categories: [{id, label, icon, color, desc?}], items: [...] }`. An item is `{ id, category, section, title, body, created, updated }` plus optional fields used by specific category renderers:
- links: `link`, `message`, `reason` (also used by the per-page links carousel on standard pages — `section: "LINKS"`, or `"LINKS - {Category}"` when the page sets `catLinks` in `PAGES`)
- subjects/astrology images: `kind: "image"|"text"`, `file`, `important`, `part: "material"?`, `label`, `message`
- todo goals: `periodStart`, `periodEnd` (drives the weekly/monthly "Missed" logic), `important`
- any: `color`, `related: [ids]`

`settings` holds `theme` and `importantSubjects`. **Sections are just `item.section` strings** — there is no separate section record (e.g. a "subject" in the Subjects menu is a distinct `section` value).

### The portable store
All persistent data lives in **`panel/store/`** = `db.json` + `seed.json` + `backups/` (auto, last 80; deleted images are moved to `backups/images/` rather than erased) + `images/` (uploaded files). Copying `store/` alone transfers everything.

### Client-only state
Home "pins" (notes shown on Home) and which subjects appear on Home persist in **browser `localStorage`** (`tatva_pins`, `tatva_homesubjects`), deliberately **not** in `db.json` — so they survive refresh but are excluded from backups/exports.

## How data is edited

There is **no UI to add categories** — categories (menus) are created/modified by running one-off Node scripts in `panel/data/` that read and rewrite `store/db.json` directly. This is the normal workflow for bulk/structural changes:
```bash
node data/merge-cmd6.js         # e.g. add categories, set flags
node data/migrate-to-store.js   # the script that created store/
```
`seed-build.js` regenerates `seed.json`; `repair-encoding.js` / `repair-arrows.js` fix mojibake (see below).

**Race-condition gotcha:** these scripts edit `store/db.json` on disk while a browser tab may have the DB in memory. If that tab saves afterward it will **overwrite the script's changes**. After running a data script, hard-refresh the open Panel tab (and avoid leaving multiple Panel tabs open).

**Encoding gotcha:** writing non-ASCII typographic characters (`·`, `—`, `→`, `×`, `₹`, `≈`, `≠`) into the data via tooling has previously corrupted them to `�` (U+FFFD) or `?`. Prefer plain ASCII in data; the `repair-*.js` scripts clean up existing mojibake.

## Exports
`POST /api/export` (`{ category: "<id>"|"all", section?: "<carousel>" }`) writes a **per-page / per-carousel folder tree** under `Desktop/Tatva Exports/` — see `.claude/exports.md`. For each carousel (`section`) of each page (`category`):
- **images** → `{page}/{carousel}/images/*` (actual image files copied)
- **text notes** → `{page}/{carousel}/{carousel}.txt`, one file, notes separated by `<---- NOTE n ---->` markers with a `note message :` line
- **links** → `{page}/LINKS/{category if avail}/links.txt` (categorized cat-Links carousels get a `{category}` subfolder; plain `LINKS` carousels go straight under `LINKS/`), each link as `title:` / `link:` / `message:` (message omitted when absent)

Passing `section` limits the export to that one carousel (used by the carousel ⚙ menu's Export); omitting it exports the whole page; `category:"all"` exports every page. Markdown is stripped; files are UTF-8 with BOM. (The older `POST /api/export-subjects` images-only endpoint still exists but the client no longer uses it.)
