# Graft

## Project Overview

Graft is a SQL database editor with an infinite canvas/whiteboard interface, inspired by Jupyter Notebooks but replacing linear scrolling with spatial organization. SQL blocks (query, migration, stored procedure, trigger, view, script) are positioned freely on a canvas and visually connected to each other and to schema objects.

Target audience: **developers and DBAs**, not data analysts or BI users. This is the differentiator vs. existing canvas-based SQL tools (Count.co, Hex, Mode, Deepnote), which are built for analytics/exploration, not low-level DB work like migrations and stored procedures.

Ambition: a **complete, heavy tool** ("heavy" = comprehensive, not slow) at the scope of **DBeaver / DataGrip** — a full DB IDE, not a minimal editor. It ships as a classic desktop app shell (native menu bar File/Edit/View/Window on macOS + Windows, plus a sidebar for connections/schema), with the **canvas as the central surface** around which the conventional IDE surfaces are organized — the canvas stays the spine, it must not become a gimmick bolted onto a DBeaver clone. **Postgres, MySQL and SQLite are all indispensable** engines (SQLite-only in v0.1 is just the starting point). See `docs/conceptuel.md` and `docs/technique.md` for the detailed direction. (The current v0.1 skeleton is intentionally minimal and will be reworked to host this shell.)

**Target platforms**: **macOS** and **Windows** are the shipping targets — the app must feel native on both (native window chrome / menu bar / dialogs). **Linux is not a shipping target**; it may work as a byproduct of Tauri, but no design decision should sacrifice the macOS/Windows experience for Linux polish. WSL2 is a *dev environment* only (via WSLg it renders through GTK, which gives a rough decoration bar that is not representative of the real Windows build).

Current phase: v0.1 (proof of concept) — initial codebase scaffolded and building (Tauri + React + React Flow + sqlx/SQLite).

## Tech Stack (decided — do not suggest alternatives without flagging the tradeoff)

- **Shell**: Tauri (Rust). Not Electron — smaller binaries, and DB drivers run natively in Rust instead of through a Node backend.
- **Frontend**: React + TypeScript + Vite. Not Next.js — Next solves web problems (SSR, server routing) that don't exist in a local Tauri webview; Vite is the official Tauri integration.
- **Canvas**: React Flow. Not tldraw — Graft's blocks need a real nodes/edges graph model (block ↔ schema object connections), which is React Flow's core domain. tldraw is better suited to freeform whiteboard/annotation, which is not the primary need here.
- **SQL editor**: CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-sql`). Chosen over Monaco: the canvas embeds many small editors (one per block), where Monaco's per-instance weight is costly, while CodeMirror is light and ships schema-aware SQL autocompletion + highlighting out of the box. (Resolves the former open question.)
- **SQL LSP**: sql-language-server (joe-re, Node) — covers Postgres, MySQL, and SQLite natively in one LSP, unlike postgres-language-server (Supabase/postgrestools) which is Postgres-only but more robust (built on libpg_query). Possible future migration to postgres-language-server for Postgres-specific users.
- **DB connections**: native Rust drivers in the Tauri backend. `sqlx` recommended for a unified async API across Postgres/MySQL/SQLite rather than juggling separate crates per engine.
- **State management**: Zustand. Avoids the cascading re-renders Context API causes with per-block state (position, execution status, results).

## Non-Goals

- Not a BI tool or dashboard builder
- Not a no-code ORM/query builder
- Not real-time collaborative (not in v1 — architecture should not preclude it later, e.g. via CRDTs)

## Open Questions (not yet decided — don't assume an answer)

- Block granularity: one block = one SQL statement? one migration file? one "subject" (everything touching a given table)?
- Business model: open source core + paid pro features, vs. fully commercial?
- Persistence: local `.graft` files (JSON, Git-diff-friendly) vs. embedded SQLite (better for the full-text search across blocks already planned as a core feature) — possibly both
- GraphQL: whether/how to support it. Leaning: viable as a *feature* (generate/expose a GraphQL API from the schema, à la PostGraphile/Hasura) but only as a late, optional module tied to the schema explorer; reject as an internal frontend↔backend transport (Tauri IPC already covers that). See `docs/technique.md` § GraphQL.

## Living documentation (maintenance rule — always follow)

The `docs/` folder holds the project's living documentation, in French, kept in sync with the code:

- `docs/conceptuel.md` — conceptual explanation (vision, audience, differentiator, block model, non-goals, open questions)
- `docs/technique.md` — technical explanation (architecture, stack, file layout, data flow, persistence format, build/run)
- `docs/guide.md` — user guide (install, launch, day-to-day usage)
- `docs/design-brief.md` — design-system intent brief

The design system itself lives in **Claude Design** (project "Wireframe application design") and is mirrored in `src/styles/tokens/*.css` + `src/styles/app.css`; access/sync via the `claude_design` MCP (`/design-sync`). Font: JetBrains Mono bundled via `@fontsource` (no CDN). Themes via `[data-theme]`, density via `[data-density]`. Keep the mirrored tokens in sync when the DS changes (see the `design-system` memory).

**Rule:** whenever you modify the project (features, architecture, stack, file layout, build steps, usage), update the relevant `docs/` file(s) in the same change so they never drift from reality. Treat these docs as part of "done" — a change is not complete until the docs reflect it. Keep them in French.

## Roadmap

- **v0.1 (POC)**: canvas with draggable SQL blocks, local SQLite connection, inline query execution, local JSON notebook save
- **v0.2**: Monaco integrated in blocks, basic autocomplete (tables/columns), syntax highlighting, inline errors
- **v0.3**: schema explorer, visual connections between blocks and tables, Postgres + MySQL support
- **v1.0**: polished canvas UX (zoom, groups, named zones), differentiated block types, notebook export, Tauri desktop distribution
