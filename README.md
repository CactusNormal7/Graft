# Graft

SQL database editor with an infinite canvas, for developers and DBAs. SQL blocks
(query, migration, stored procedure, trigger, view, script) live freely on a
canvas instead of a linear notebook.

> Status: **v0.1 (proof of concept)**, with much of v0.2 already in — draggable
> and resizable SQL blocks, local SQLite connection, inline query execution,
> CodeMirror 6 editor with schema autocompletion, table / JSON / chart result
> views, group containers, pages, reusable `{{favorite}}` blocks, a ⌘K palette
> (favorites), and paged JSON `.graft` project files.

## Stack

- **Shell:** Tauri 2 (Rust)
- **Frontend:** React + TypeScript + Vite
- **Canvas:** React Flow (`@xyflow/react`)
- **State:** Zustand
- **SQL editor:** CodeMirror 6
- **Charts:** Recharts
- **DB drivers:** `sqlx` — SQLite, PostgreSQL, MySQL/MariaDB (passwords in the OS keychain)
- **Tests:** Vitest (frontend) + `cargo test` (backend)

## Prerequisites

- [Node.js](https://nodejs.org) + [pnpm](https://pnpm.io)
- [Rust](https://www.rust-lang.org/tools/install) (stable) and the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

## Test

```bash
pnpm test                      # Vitest
pnpm exec tsc --noEmit         # type-check
(cd src-tauri && cargo test)   # Rust unit tests
```

## Using v0.1

1. **+ New project** on the home screen — name, location, and a connection:
   a SQLite file (or leave empty to create `<name>.db`), or a PostgreSQL /
   MySQL server (**Test connection** checks it).
2. **+ Block** — choose a block type; it appears on the canvas.
3. Edit the SQL and hit **▶** (or Ctrl/Cmd+Enter) to run it against the
   database. Results (table / JSON / chart) or errors render inline.
4. **Save** (Ctrl/Cmd+S) persists the project to its `.graft` JSON file; reopen
   it from the recent list or **Open file…**.

See [`docs/guide.md`](docs/guide.md) for everything else (groups, pages,
favorites, INSERT generation, row actions…).

## Layout

```
src/                 React frontend
  canvas/            React Flow canvas, block/result/group nodes, result views
  components/        Toolbar, sidebar, editor, palette, page tabs, modals
  screens/           Home screen
  store/             Zustand store (pages, nodes, edges, project, actions)
  types.ts           Shared domain types
src-tauri/src/
  db/                SQLite / Postgres / MySQL execution + introspection
  db_commands.rs     Tauri commands over db/ (passwords read from the keychain)
  secrets.rs         OS keychain access
  notebook.rs        .graft file save/load, project paths
  dialogs.rs         Native dialogs (run from the backend)
  scope.rs           Session file-access grants
  lib.rs             Tauri builder + command registration
```

## Documentation

Living docs (French), kept in sync with the code:

- [`docs/conceptuel.md`](docs/conceptuel.md) — concept, vision, modèle de blocs
- [`docs/technique.md`](docs/technique.md) — architecture, stack, flux de données
- [`docs/guide.md`](docs/guide.md) — installation et utilisation

See `CLAUDE.md` for the full project brief, roadmap, and open questions.
