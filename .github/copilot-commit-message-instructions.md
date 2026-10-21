# Commit message instructions

Write the commit message in the **Conventional Commits 1.0.0** format, in English:

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Type (required)

- `feat`: a new user-facing feature
- `fix`: a bug fix
- `refactor`: a code change that neither fixes a bug nor adds a feature
- `perf`: a performance improvement
- `test`: adding or fixing tests only
- `docs`: documentation only (`docs/`, README, CLAUDE.md, comments)
- `style`: formatting only, no behaviour change (not CSS: UI styling is `feat` or `fix`)
- `build`: build system, dependencies, Cargo/pnpm config
- `ci`: CI configuration
- `chore`: anything else that touches neither source nor tests

## Scope (optional, lowercase)

Use the area of the repo that changed. Omit the scope when the change spans several areas.

- `core`: `crates/graft-core` (SQL engine, `.graft` model, snippets)
- `mcp`: `crates/graft-mcp` (MCP server for Claude)
- `tauri`: `src-tauri` (desktop backend, commands, file watching)
- `canvas`: `src/canvas` (blocks, result views, row actions, selection)
- `editor`: the SQL editor (CodeMirror)
- `store`: `src/store` (Zustand store, persistence, unsaved changes)
- `ui`: shell components, styles, design tokens
- `sidebar`, `home`: those screens or components
- `docs`: living documentation in `docs/`

## Subject (required)

- Imperative mood, lowercase first letter, no trailing period: `add row multi-selection`, not `Added…`.
- At most 72 characters for the whole first line.
- Describe what changes for the user or the codebase, not the files touched.

## Body (optional)

- Leave one blank line after the subject. Wrap lines at 72 characters.
- Explain **why** and any notable trade-off. A short bullet list is fine for multi-part changes.

## Footer (optional)

- A breaking change (`.graft` format, Tauri command signature, MCP tool contract) gets `!` after the type or scope, plus a `BREAKING CHANGE: <description>` footer.
- Reference issues as `Closes #123` or `Refs #123`.

## Examples

```
feat(canvas): select result rows with click, shift and cmd/ctrl-click
```

```
fix(store): resolve a relative dbPath against the project directory

The backend resolved it against its working directory and created a
stray empty database there.
```

```
feat(mcp)!: rename run_sql tool to run_query

BREAKING CHANGE: MCP clients must call run_query instead of run_sql.
```
