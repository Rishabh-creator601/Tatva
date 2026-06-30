# 01 — Tech Stack

The guiding principle: **no dependencies, no build, no magic.** Everything runs on
what ships with Node.js and the browser.

## Runtime & languages

| Layer | Tech | Notes |
|-------|------|-------|
| Server | **Node.js** (stdlib only) | `http`, `fs`, `path`, `os`, `child_process` — nothing from npm |
| Client | **Vanilla JavaScript (ES2020+)** | One file `public/app.js`, no framework, no bundler |
| Markup | **HTML5** | `public/index.html` — static DOM scaffold |
| Styling | **CSS3** | `public/style.css` — CSS variables, `data-theme` dark/light |
| Data | **JSON file** | `store/db.json` is the entire database |
| Launchers | **Batch + VBScript** | `start.bat`, `start-hidden.vbs`, Desktop `Tatva Panel.vbs` |
| Data tooling | **Node one-off scripts** | `panel/data/*.js` rewrite `db.json` directly |

## Dependencies

**Zero.** There is no `package.json`, no `node_modules`, no lockfile. Nothing to
`npm install`. This is deliberate — the project is meant to be copyable and to run on
any machine that has Node, forever, with no supply-chain surface.

## Node stdlib modules actually used (server.js)

- `http` — the web server
- `fs` — read/write `db.json`, copy backups, serve images, `statfsSync` for disk usage
- `path` — safe path joins, extension/MIME lookup, path-traversal guards
- `os` — CPU/RAM stats for `/api/sysinfo`, `homedir()` for Desktop exports
- `child_process.exec` — shells out to PowerShell `Get-NetAdapterStatistics` for net throughput

## Browser APIs used (app.js)

- `fetch` — talks to the REST API
- `localStorage` — client-only state (`tatva_pins`, `tatva_homesubjects`)
- `FileReader` / drag-drop — image & text-file uploads (base64 data URLs)
- `AbortSignal.timeout` — bounded fetches for the Home widgets (weather/quotes)
- Open-Meteo / quote APIs — optional online enrich on the Home page (fail-soft)

## Why these choices

- **No framework** keeps the SPA in one readable file; the whole client is ~1,200 lines.
- **JSON file DB** means the data is human-readable, diff-able, and trivially backed up.
- **Whole-DB POST on every edit** trades bandwidth (tiny, local) for dead-simple
  consistency — there is never a partial-write or migration-mismatch problem.
- **PowerShell shell-out** is the pragmatic way to get Windows net stats without a native addon.

## Platform

- **Windows 11**, single user.
- Server binds **localhost:4321** only — never exposed to a network.
- Static files served with `Cache-Control: no-store` (hard-refresh `Ctrl+Shift+R` to be safe).
