# Tatva Panel — Project Plan & Architecture

A single-user, local-first knowledge/dashboard system on Windows.
Zero dependencies, no build step, no package manager — pure Node.js stdlib + vanilla JS.

This folder documents how the whole thing fits together.

## Documents

| File | What's inside |
|------|----------------|
| [01-tech-stack.md](01-tech-stack.md) | Languages, runtime, libraries (none!), why each choice |
| [02-code-structure.md](02-code-structure.md) | Every file/folder, server routes, client modules |
| [03-file-management.md](03-file-management.md) | The portable `store/`, backups, images, data scripts |
| [04-flowcharts.md](04-flowcharts.md) | Request flow, save loop, render pipeline, data scripts |

## 30-second summary

```
Browser (public/app.js, one-file SPA)
        |  loads whole DB into memory once
        |  every edit -> re-POST entire DB (debounced 350ms)
        v
Node http server (panel/server.js, zero deps)
        |  backs up old db.json, then overwrites
        v
panel/store/   = db.json + seed.json + backups/ + images/
                 (copy this one folder = move everything)
```

- **Run:** `cd panel && node server.js` -> http://localhost:4321
  (or double-click `Tatva Panel.vbs` on the Desktop — launches hidden, no console window)
- **No tests, no linter.** Sanity check: `node -c server.js`, `node -c public/app.js`
- **Two parts in the repo:** the **Panel** (`panel/`, actively developed) and the
  **legacy standalone dashboards** (`index.html` + `personality/`, `short-notes/`,
  `astrology/`, `todo/` — old self-contained HTML, rarely touched).

> Generated as living documentation. If the code and these docs disagree, the code wins —
> update these files when the architecture changes.
