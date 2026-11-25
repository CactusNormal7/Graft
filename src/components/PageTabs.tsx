import { useState } from "react";
import { useGraftStore } from "../store/useGraftStore";
import { BlockContextMenu, type MenuAction } from "../canvas/BlockContextMenu";

/**
 * Excel-like sheet tabs at the bottom of the canvas. Each tab is a page with
 * its own nodes/edges. Click to switch, double-click to rename, right-click for
 * a menu (rename / delete), "×" (or Mod+W) closes a page, and "+" adds one.
 */
export function PageTabs() {
  const pages = useGraftStore((s) => s.pages);
  const activePageId = useGraftStore((s) => s.activePageId);
  const switchPage = useGraftStore((s) => s.switchPage);
  const addPage = useGraftStore((s) => s.addPage);
  const renamePage = useGraftStore((s) => s.renamePage);
  const deletePage = useGraftStore((s) => s.deletePage);
  const closePage = useGraftStore((s) => s.closePage);
  const canClose = pages.length > 1;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<
    { x: number; y: number; actions: MenuAction[] } | null
  >(null);

  const startRename = (id: string, name: string) => {
    setDraft(name);
    setEditingId(id);
  };
  const commit = (id: string) => {
    renamePage(id, draft);
    setEditingId(null);
  };

  const openMenu = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: "Rename", onClick: () => startRename(id, name) },
        {
          label: "Delete page",
          onClick: () => deletePage(id),
          danger: true,
          disabled: pages.length <= 1,
        },
      ],
    });
  };

  return (
    <div className="page-tabs">
      {pages.map((p) => {
        const active = p.id === activePageId;
        return editingId === p.id ? (
          <input
            key={p.id}
            autoFocus
            className="page-tabs__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(p.id);
              if (e.key === "Escape") setEditingId(null);
            }}
          />
        ) : (
          <div
            key={p.id}
            className={`page-tabs__tab${active ? " is-active" : ""}`}
            onContextMenu={(e) => openMenu(e, p.id, p.name)}
          >
            <button
              className="page-tabs__name"
              onClick={() => switchPage(p.id)}
              onDoubleClick={() => startRename(p.id, p.name)}
              title={p.name}
            >
              {p.name}
            </button>
            {canClose && (
              <button
                className="page-tabs__close"
                onClick={() => void closePage(p.id)}
                title="Close page"
                aria-label={`Close ${p.name}`}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button className="page-tabs__add" onClick={addPage} title="Add page">
        +
      </button>

      {menu && (
        <BlockContextMenu
          x={menu.x}
          y={menu.y}
          actions={menu.actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
