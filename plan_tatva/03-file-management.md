# 03 — File Management

## The portable store: `panel/store/`

Everything persistent lives here. **Copy `store/` alone and you've moved the whole app's data.**

```
store/
├── db.json        # the entire database (settings + categories + items)
├── seed.json      # first-run seed; server copies it to db.json if none exists
├── backups/       # auto rolling backups, last 80 (db-YYYYMMDD-HHMMSS.json)
│   └── images/    # DELETED images land here (move, not erase) — recoverable
└── images/        # uploaded image & text files, referenced by item.file
```

## Data model (`db.json`)

```jsonc
{
  "settings": {
    "theme": "dark" | "light",
    "carousels": { "<category>/<section>": { important, home, msg, color, order } }
  },
  "categories": [ { "id", "label", "icon", "color", "desc?" } ],
  "items":      [ { ...see below } ]
}
```

**An item** (the universal record):
```jsonc
{
  "id", "category", "section",    // section is just a STRING — there is no section record
  "title", "body", "created", "updated"
}
```
Optional fields used by specific renderers:
- **links:** `link`, `message`, `reason` (section `"LINKS"` or `"LINKS - {Category}"`)
- **images / text files:** `kind: "image"|"text"`, `file`, `important`, `part:"material"?`, `label`, `message`
- **todo goals:** `periodStart`, `periodEnd` (drives weekly/monthly "Missed"), `important`
- **any:** `color`, `related: [ids]`

> A "subject" or any carousel title is **just an `item.section` string** — creating a
> section means giving items that section value; deleting all those items removes it.

## Categories (current)

`home`, `instant`, `personality`, `shortnotes`, `astrology`, `todo`, `programming`,
`college`, `subjects`. There is **no UI to add categories** — they're created/edited by
running Node scripts in `panel/data/`.

## Backups — two independent safety nets

1. **DB backups (server, automatic):** every `POST /api/db` copies the current `db.json`
   to `backups/db-<timestamp>.json` *before* overwriting, then prunes to the newest 80.
2. **Image deletes (server):** `delete-image` **moves** the file to `backups/images/`
   instead of erasing it — fully recoverable.
3. **Manual script backups:** the `data/*.js` scripts also drop a labelled copy
   (e.g. `db.before-life-lessons-<stamp>.json`) before they touch anything.

## Images: naming & serving

- Upload (`/api/upload-image`) sanitizes the base name to `[a-z0-9_-]`, truncates to 40
  chars, and de-dupes with `-1`, `-2`… So `Screenshot 2026-03-02 072520.png` becomes
  `Screenshot_2026-03-02_072520.png` on disk, while the item keeps the original as `title`.
- Served at `/images/<file>` with a `PUBLIC`/`IMAGES` prefix guard against path traversal.

## Client-only state (NOT in db.json)

Stored in browser **localStorage**, deliberately excluded from backups/exports:
- `tatva_pins` — notes pinned to Home
- `tatva_homesubjects` — which subjects show on Home

## Editing data the "admin" way — `panel/data/*.js`

Structural / bulk changes are done by one-off scripts that read and rewrite `db.json`:
```bash
node data/import-life-lessons.js   # e.g. import images into a page
node data/migrate-to-store.js      # created store/
node data/seed-build.js            # regenerate seed.json
node data/repair-encoding.js       # fix mojibake (· — → × ₹ ≈ ≠ corrupted to ? / U+FFFD)
```

### Two gotchas (important)

- **Race condition:** these scripts edit `db.json` on disk while an open Panel tab holds
  the DB in memory. If that tab saves afterward it **overwrites the script's changes**.
  -> After running a data script, **hard-refresh the Panel tab (Ctrl+Shift+R)** and avoid
  leaving multiple Panel tabs open.
- **Encoding:** writing fancy typographic chars (`· — → × ₹ ≈ ≠`) via tooling has corrupted
  them to `?` / U+FFFD before. **Prefer plain ASCII in data;** use `repair-*.js` to clean up.

## Restart rules

- Editing **`server.js`** -> **restart Node** (no hot-reload). `EADDRINUSE` means an old
  instance still holds 4321: find it via `Get-NetTCPConnection -LocalPort 4321 -State Listen`
  and `Stop-Process -Id <pid> -Force`.
- Editing anything in **`public/`** -> no restart, just **hard-refresh** the browser.

## Exports — `Desktop/Tatva Exports/`

`POST /api/export` writes a per-page / per-carousel folder tree:
- **images** -> `{page}/{carousel}/images/*` (actual files copied)
- **text notes** -> `{page}/{carousel}/{carousel}.txt`, notes split by `<---- NOTE n ---->`
- **links** -> `{page}/LINKS/{category if avail}/links.txt`

`section` limits the export to one carousel; omit it for the whole page; `category:"all"`
exports everything. Markdown stripped, files are UTF-8 with BOM.
