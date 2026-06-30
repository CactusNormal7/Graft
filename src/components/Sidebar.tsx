import { useGraftStore } from "../store/useGraftStore";
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
 * Canvas sidebar: schema explorer + block list (wireframe screen 03).
 * NOTE: the schema tree is a static placeholder — live schema introspection
 * is not implemented yet (planned for v0.3 alongside Postgres/MySQL support).
 */
export function Sidebar() {
  const nodes = useGraftStore((s) => s.nodes);

  return (
    <aside className="sidebar">
      <div className="label">Schema</div>
      <input className="schema-search" placeholder="Search…" disabled />
      <div className="sidebar__scroll">
        {/* Placeholder schema — replace with real introspection in v0.3. */}
        <div className="schema-row">
          <span className="text-muted">▶</span>
          <span className="text-sm">users</span>
          <span className="schema-tag">table</span>
        </div>
        <div className="schema-row">
          <span className="text-muted">▶</span>
          <span className="text-sm">orders</span>
          <span className="schema-tag">table</span>
        </div>
        <div className="schema-row">
          <span className="text-muted">▶</span>
          <span className="text-sm">products</span>
          <span className="schema-tag">table</span>
        </div>
        <div className="text-muted" style={{ marginTop: "8px", fontStyle: "italic" }}>
          (schema introspection — v0.3)
        </div>
      </div>

      <div className="sep sep--h" />
      <div className="label">Blocks ({nodes.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {nodes.length === 0 && <span className="text-muted">No blocks yet</span>}
        {nodes.map((n) => (
          <div key={n.id} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span className={`badge badge--${n.data.blockType}`}>
              {BADGE_LETTER[n.data.blockType]}
            </span>
            <span className="text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {n.data.title}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
