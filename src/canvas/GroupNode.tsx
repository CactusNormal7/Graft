import { useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useGraftStore, type GroupNode as GroupNodeType } from "../store/useGraftStore";

/** Colors offered in the inline swatch picker (mirror of the store palette). */
const SWATCHES = ["#6ea8fe", "#4ade80", "#fbbf74", "#f0819b", "#c9a8ff", "#5eead4"];

/** Translucent version of a hex color for fills. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A colored container node. It renders *behind* the blocks (groups are kept
 * first in the nodes array); blocks dropped inside become React Flow children
 * and move with the group. Only the header strip and empty body are grabbable —
 * blocks on top keep their own drag/interaction.
 */
export function GroupNode({ id, data }: NodeProps<GroupNodeType>) {
  const renameGroup = useGraftStore((s) => s.renameGroup);
  const setGroupColor = useGraftStore((s) => s.setGroupColor);
  const deleteGroup = useGraftStore((s) => s.deleteGroup);
  const resizeBlock = useGraftStore((s) => s.resizeBlock);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.title);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const color = data.color;

  const commit = () => {
    const next = draft.trim();
    if (next && next !== data.title) renameGroup(id, next);
    else setDraft(data.title);
    setEditing(false);
  };

  return (
    <div
      className="group-node"
      style={{ borderColor: color, background: hexToRgba(color, 0.06) }}
    >
      {/* Resizer stays active but invisible — no second frame. Handles fade in
          only when the pointer is near the group (see CSS). */}
      <NodeResizer
        minWidth={220}
        minHeight={140}
        isVisible
        lineClassName="group-node__resize-line"
        handleClassName="group-node__resize-handle"
        onResizeEnd={(_evt, params) => resizeBlock(id, params.width, params.height)}
      />

      <div
        className="group-node__header"
        style={{ background: hexToRgba(color, 0.16), borderColor: hexToRgba(color, 0.4) }}
      >
        {editing ? (
          <input
            autoFocus
            className="group-node__title-input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(data.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="group-node__title"
            title="Double-click to rename · drag to move the group"
            onDoubleClick={() => {
              setDraft(data.title);
              setEditing(true);
            }}
          >
            {data.title}
          </span>
        )}

        <div className="group-node__actions nodrag">
          <button
            className="btn group-node__icon"
            title="Change color"
            onClick={() => setPaletteOpen((o) => !o)}
          >
            <span className="group-node__swatch" style={{ background: color }} />
          </button>
          <button
            className="btn group-node__icon"
            title="Delete group (keeps the blocks inside)"
            onClick={() => deleteGroup(id)}
          >
            ✕
          </button>
        </div>

        {paletteOpen && (
          <div className="group-node__palette nodrag">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className="group-node__swatch-btn"
                style={{ background: c }}
                title={c}
                onClick={() => {
                  setGroupColor(id, c);
                  setPaletteOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
