import { useEffect, useRef, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { useGraftStore } from "../store/useGraftStore";
import type { BlockType } from "../types";

const BLOCK_TYPES: BlockType[] = [
  "query",
  "migration",
  "procedure",
  "trigger",
  "view",
  "script",
];

/** Top toolbar shown in the canvas view (see wireframe screens 02/03). */
export function Toolbar() {
  const dbPath = useGraftStore((s) => s.dbPath);
  const nodeCount = useGraftStore((s) => s.nodes.length);
  const addBlock = useGraftStore((s) => s.addBlock);
  const addGroup = useGraftStore((s) => s.addGroup);
  const runAll = useGraftStore((s) => s.runAll);
  const saveNotebook = useGraftStore((s) => s.saveNotebook);
  const importDataFile = useGraftStore((s) => s.importDataFile);
  const goHome = useGraftStore((s) => s.goHome);

  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const dbLabel = dbPath ? dbPath.split("/").pop() : "No database";

  return (
    <div className="toolbar">
      <button className="toolbar__brand" onClick={goHome} title="Home">
        graft
      </button>
      <span className="sep" />

      <button
        className="btn"
        style={{ color: "var(--success)", borderColor: "var(--success-dim)" }}
        title={dbPath ?? "No database connected"}
      >
        {dbLabel}
      </button>
      <span className="sep" />

      <div className="menu" ref={menuRef}>
        <button className="btn-accent" onClick={() => setMenuOpen((o) => !o)}>
          + Block
        </button>
        {menuOpen && (
          <div className="menu__list">
            {BLOCK_TYPES.map((t) => (
              <button
                key={t}
                className="menu__item"
                onClick={() => {
                  addBlock(t);
                  setMenuOpen(false);
                }}
              >
                <span className={`badge badge--${t}`}>{t[0]}</span>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="btn" onClick={addGroup} title="Add a group container">
        + Group
      </button>

      <button className="btn" onClick={runAll} disabled={nodeCount === 0}>
        ▶ Run all
      </button>
      <button className="btn" onClick={saveNotebook}>
        Save
      </button>
      <button
        className="btn"
        onClick={() => void importDataFile()}
        title="Import a nested .json (→ multi-table INSERTs) or a .sql file"
      >
        Import…
      </button>
      <button
        className="btn"
        title="Command palette — search favorite blocks (⌘K / Ctrl+K)"
        onClick={() =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", metaKey: true }),
          )
        }
      >
        ⌘K
      </button>

      <span className="toolbar__spacer" />

      <span className="toolbar__zoom">{Math.round((zoom ?? 1) * 100)}%</span>
      <button className="btn" onClick={() => zoomOut()} title="Zoom out">
        −
      </button>
      <button className="btn" onClick={() => zoomIn()} title="Zoom in">
        +
      </button>
      <button className="btn" onClick={() => fitView({ duration: 200 })} title="Fit view">
        ⊞
      </button>
    </div>
  );
}
