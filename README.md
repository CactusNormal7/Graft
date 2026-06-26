# Graft

SQL database editor with an infinite canvas, for developers and DBAs. SQL blocks
(query, migration, stored procedure, trigger, view, script) live freely on a
canvas instead of a linear notebook.

> Status: **v0.1 (proof of concept)** — draggable SQL blocks, local SQLite
> connection, inline query execution, and JSON notebook save/load.

## Stack

- **Shell:** Tauri 2 (Rust)
- **Frontend:** React + TypeScript + Vite
- **Canvas:** React Flow (`@xyflow/react`)
- **State:** Zustand
- **DB drivers:** `sqlx` (SQLite in v0.1; Postgres/MySQL planned for v0.3)

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

## Using v0.1

1. **Connect SQLite…** — pick (or point at) a `.db`/`.sqlite` file. It's created
   if missing.
2. **Add block** — choose a block type; it appears on the canvas.
3. Edit the SQL and hit **▶ Run** to execute against the connected database.
   Results (or errors) render inline in the block.
4. **Save** / **Open** — persist the canvas as a `.graft` JSON file.

## Layout

```
src/                 React frontend
  canvas/            React Flow canvas, SQL block node, toolbar, result table
  store/             Zustand store (nodes, edges, db connection, actions)
  types.ts           Shared domain types
src-tauri/src/
  db.rs              SQLite execution engine (execute_sql command)
  notebook.rs        .graft file save/load commands
  lib.rs             Tauri builder + command registration
```

## Documentation

Living docs (French), kept in sync with the code:

- [`docs/conceptuel.md`](docs/conceptuel.md) — concept, vision, modèle de blocs
- [`docs/technique.md`](docs/technique.md) — architecture, stack, flux de données
- [`docs/guide.md`](docs/guide.md) — installation et utilisation

See `CLAUDE.md` for the full project brief, roadmap, and open questions.
