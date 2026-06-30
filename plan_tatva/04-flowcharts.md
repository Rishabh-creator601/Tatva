# 04 — Flowcharts

Mermaid diagrams (render in Obsidian, GitHub, VS Code Mermaid preview).
ASCII fallbacks included where useful.

## 1. High-level architecture

```mermaid
flowchart LR
    User([User]) --> Browser
    subgraph Browser["Browser — public/"]
        IndexH[index.html<br/>DOM scaffold]
        AppJS[app.js<br/>whole SPA + in-memory db]
        CSS[style.css]
    end
    Browser <-->|fetch JSON| Server
    subgraph Server["Node http server — server.js (zero deps)"]
        API[/REST API/]
        Static[serveStatic]
    end
    Server <--> Store
    subgraph Store["panel/store/ (portable)"]
        DB[(db.json)]
        Seed[(seed.json)]
        Backups[(backups/ last 80)]
        Images[(images/)]
    end
    API -. PowerShell .-> NetStats[Get-NetAdapterStatistics]
    AppJS -. localStorage .-> LS[(pins / home subjects)]
```

## 2. App boot / load

```mermaid
sequenceDiagram
    participant B as Browser (app.js)
    participant S as server.js
    participant D as store/db.json
    B->>S: GET /api/db
    S->>D: readFileSync
    D-->>S: JSON
    S-->>B: whole DB
    B->>B: db = json; migrate legacy fields
    B->>B: applyTheme(); pick current category
    B->>B: render()  // dispatch by category
```

## 3. The save loop (every edit re-POSTs the whole DB)

```mermaid
flowchart TD
    Edit[User edits anything] --> Mutate[mutate in-memory db object]
    Mutate --> Save["save()  dirty=true, debounce 350ms"]
    Save --> Post[POST /api/db with ENTIRE db]
    Post --> Valid{valid shape?<br/>items is array}
    Valid -- no --> Err[400 -> toast 'Save error']
    Valid -- yes --> Backup[copy old db.json -> backups/db-TS.json]
    Backup --> Prune[prune backups to newest 80]
    Prune --> Write[overwrite db.json]
    Write --> OK[200 -> toast 'Saved ✓ backup made']
```

ASCII view:

```
edit -> db.{change} -> save() --350ms--> POST /api/db (full db)
                                             |
                       server: backup old db.json -> backups/
                               prune > 80
                               write new db.json
                                             |
                                       toast: Saved ✓
```

## 4. Request routing in server.js (order matters — prefix matching)

```mermaid
flowchart TD
    Req[incoming request] --> Q1{startsWith /api/db}
    Q1 -- yes --> DB[GET return db / POST backup+write]
    Q1 -- no --> Q2{/api/export AND NOT /api/export-subjects}
    Q2 -- yes --> Exp[write Desktop/Tatva Exports tree]
    Q2 -- no --> Q3{/api/sysinfo}
    Q3 -- yes --> Sys[cpu/ram/disk/net]
    Q3 -- no --> Q4{/api/upload|rename|delete-image}
    Q4 -- yes --> Img[mutate store/images]
    Q4 -- no --> Q5{/api/export-subjects}
    Q5 -- yes --> ExpS[legacy images export]
    Q5 -- no --> Q6{/images/*}
    Q6 -- yes --> Serve[serve file from images/]
    Q6 -- no --> StaticF[serveStatic from public/]
```

> ⚠️ `/api/export-subjects` lives **after** the `/api/export` guard precisely because
> `startsWith('/api/export')` would otherwise swallow it.

## 5. render() dispatch

```mermaid
flowchart TD
    R[render] --> Home{current == home}
    Home -- yes --> RH[renderHome: clock, weather, quotes, pins, sysinfo]
    Home -- no --> Subj{current == subjects}
    Subj -- yes --> RS[renderSubjects: image carousels]
    Subj -- no --> Std{isStandard via PAGES}
    Std -- yes --> RStd[renderStandard: carousels of image/text/note/link]
    Std -- no --> Todo{current == todo}
    Todo -- yes --> RT[Important / sections / Missed grouping]
    Todo -- no --> Gen[generic section cards via cardHTML]
```

## 6. Data-script workflow (the "admin UI")

```mermaid
flowchart LR
    Write[write data/xyz.js] --> Backup[script copies db.json -> labelled backup]
    Backup --> Mutate[read db.json, push/modify items, write db.json]
    Mutate --> Refresh[HARD-REFRESH open Panel tab Ctrl+Shift+R]
    Refresh --> Done[changes live]
    Mutate -. risk .-> Race[open tab saves later -> overwrites script!]
    Race -. avoided by .-> Refresh
```

## 7. Launch (zero-window double-click)

```mermaid
flowchart TD
    DC[Double-click 'Tatva Panel.vbs'] --> VBS[VBS runs the .bat hidden mode 0]
    VBS --> Check{port 4321 listening?}
    Check -- no --> StartHidden[wscript start-hidden.vbs -> node server.js hidden]
    Check -- yes --> Skip[server already running]
    StartHidden --> Open
    Skip --> Open[open http://localhost:4321 in browser]
```
