import { useMemo, useState } from "react";
import { useGraftStore } from "../store/useGraftStore";
import { insertIntoEditor } from "../canvas/editorRegistry";
import type { BlockType } from "../types";

const BADGE_LETTER: Record<BlockType, string> = {
  query: "q",
  migration: "m",
  procedure: "s",
  trigger: "t",
  view: "v",
  script: "s",
};

/**
 * Canvas sidebar: live schema explorer (tables introspected from the DB, with
 * expandable columns and a search filter) + block list. Clicking a table or
 * column inserts its name into the currently-focused block editor — the
 * classic "quick fill" ergonomics of a SQL IDE.
 */
export function Sidebar() {
  // Subscribe to the raw nodes array (stable reference), then derive the
  // filtered list in a memo. Filtering INSIDE the selector would return a
  // fresh array each call, which Object.is compares as "changed" and pushes
  // Zustand into an infinite re-render loop (blank screen).
  const allNodes = useGraftStore((s) => s.nodes);
  const nodes = useMemo(
    () =>
      allNodes.filter(
        (n): n is import("../store/useGraftStore").SqlNode =>
          n.type === "sqlBlock",
      ),
    [allNodes],
  );
  const schema = useGraftStore((s) => s.schema);
  const dbPath = useGraftStore((s) => s.dbPath);
  const refreshSchema = useGraftStore((s) => s.refreshSchema);
  const focusedBlockId = useGraftStore((s) => s.focusedBlockId);
  const addSelectBlock = useGraftStore((s) => s.addSelectBlock);
  const snippets = useGraftStore((s) => s.snippets);
  const insertSnippetRef = useGraftStore((s) => s.insertSnippetRef);
  const addBlockFromSnippet = useGraftStore((s) => s.addBlockFromSnippet);
  const deleteSnippet = useGraftStore((s) => s.deleteSnippet);

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tables = useMemo(() => Object.keys(schema).sort(), [schema]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(
      (t) =>
        t.toLowerCase().includes(q) ||
        schema[t].some((c) => c.toLowerCase().includes(q)),
    );
  }, [tables, schema, query]);

  // If there's an active search, auto-expand any table whose columns match
  // so the hit is visible without clicking.
  const isRowExpanded = (t: string) => {
    if (expanded[t]) return true;
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return schema[t].some((c) => c.toLowerCase().includes(q));
  };

  const insert = (text: string) => {
    if (!focusedBlockId) return;
    insertIntoEditor(focusedBlockId, text);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__row">
        <span className="label">Schema</span>
        <button
          className="btn sidebar__refresh"
          title="Refresh schema"
          onClick={() => void refreshSchema()}
          disabled={!dbPath}
        >
          ↻
        </button>
      </div>
      <input
        className="schema-search"
        placeholder="Search tables & columns…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="sidebar__scroll">
        {!dbPath && (
          <span className="text-muted">No database connected</span>
        )}
        {dbPath && tables.length === 0 && (
          <span className="text-muted">Empty schema — create a table.</span>
        )}
        {filtered.map((table) => {
          const open = isRowExpanded(table);
          const cols = schema[table];
          return (
            <div key={table}>
              <div
                className="schema-row"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [table]: !prev[table] }))
                }
                title="Click ▸ to expand · double-click name for a SELECT block"
              >
                <span className="schema-row__caret">{open ? "▾" : "▸"}</span>
                <span
                  className="schema-row__name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    addSelectBlock(table);
                  }}
                >
                  {table}
                </span>
                <span className="schema-tag">
                  {cols.length}
                </span>
              </div>
              {open && (
                <div className="schema-cols">
                  {cols.map((col) => (
                    <div
                      key={col}
                      className="schema-col"
                      title={`Insert "${table}.${col}" into the focused block`}
                      onDoubleClick={() => insert(`${table}.${col}`)}
                    >
                      · {col}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {dbPath && filtered.length === 0 && tables.length > 0 && (
          <span className="text-muted">No match for “{query}”.</span>
        )}
      </div>

      <div className="sep sep--h" />
      <div className="label">Favorites ({snippets.length})</div>
      <div className="sidebar__blocks">
        {snippets.length === 0 && (
          <span className="text-muted">
            Right-click a block → “Save as favorite…”
          </span>
        )}
        {snippets.map((s) => (
          <div
            key={s.id}
            className="sidebar__block"
            title={
              focusedBlockId
                ? `Double-click to insert {{${s.name}}} · right-click to remove`
                : `Double-click to open as a block · right-click to remove`
            }
            onDoubleClick={() =>
              focusedBlockId ? insertSnippetRef(s.id) : addBlockFromSnippet(s.id)
            }
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`Remove favorite “${s.name}”?`)) {
                deleteSnippet(s.id);
              }
            }}
          >
            <span className={`badge badge--${s.blockType}`}>
              {BADGE_LETTER[s.blockType]}
            </span>
            <span className="sidebar__block-name">{`{{${s.name}}}`}</span>
          </div>
        ))}
      </div>

      <div className="sep sep--h" />
      <div className="label">Blocks ({nodes.length})</div>
      <div className="sidebar__blocks">
        {nodes.length === 0 && <span className="text-muted">No blocks yet</span>}
        {nodes.map((n) => (
          <div
            key={n.id}
            className={`sidebar__block ${focusedBlockId === n.id ? "is-active" : ""}`}
            title={n.data.title}
          >
            <span className={`badge badge--${n.data.blockType}`}>
              {BADGE_LETTER[n.data.blockType]}
            </span>
            <span className="sidebar__block-name">{n.data.title}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
