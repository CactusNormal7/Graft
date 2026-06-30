import { useState } from "react";
import { useGraftStore } from "../store/useGraftStore";
import { NewProjectModal } from "../components/NewProjectModal";
import type { RecentProject } from "../types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * Home / connect screen. Create a new project (modal: name + location + db type)
 * or reopen a recent one. Recent projects are persisted locally.
 */
export function HomeScreen() {
  const recents = useGraftStore((s) => s.recentProjects);
  const openProjectByPath = useGraftStore((s) => s.openProjectByPath);
  const openProjectFromDialog = useGraftStore((s) => s.openProjectFromDialog);
  const removeRecent = useGraftStore((s) => s.removeRecent);

  const [showNew, setShowNew] = useState(false);

  return (
    <div className="app-shell">
      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="toolbar__brand" style={{ marginBottom: "4px" }}>graft</div>
          <button className="btn-accent" style={{ textAlign: "center" }} onClick={() => setShowNew(true)}>
            + New project
          </button>
          <button className="btn" style={{ textAlign: "center" }} onClick={openProjectFromDialog}>
            Open file…
          </button>

          <div className="sep sep--h" />
          <div className="label">Recent projects</div>
          <div className="sidebar__scroll">
            {recents.length === 0 && <span className="text-muted">No projects yet</span>}
            {recents.map((p) => (
              <div key={p.projectPath} className="text-xs" style={{ cursor: "pointer", padding: "2px 0" }}
                onClick={() => openProjectByPath(p.projectPath)} title={p.projectPath}>
                {p.name}.graft
              </div>
            ))}
          </div>
          <div className="text-muted">v0.1.0</div>
        </aside>

        {/* Main */}
        <main className="home">
          <div>
            <div className="text-h">Projects</div>
            <div className="text-muted" style={{ marginTop: "4px" }}>
              Create a new project or reopen a recent one.
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-accent" style={{ fontSize: "12px", padding: "7px 20px" }} onClick={() => setShowNew(true)}>
              + New project
            </button>
            <button className="btn" style={{ fontSize: "12px", padding: "7px 20px" }} onClick={openProjectFromDialog}>
              Open file…
            </button>
          </div>

          <div>
            <div className="label" style={{ marginBottom: "10px" }}>Recent projects</div>
            <RecentTable recents={recents} onOpen={openProjectByPath} onRemove={removeRecent} />
          </div>
        </main>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function RecentTable({
  recents,
  onOpen,
  onRemove,
}: {
  recents: RecentProject[];
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  if (recents.length === 0) {
    return (
      <div className="recent">
        <div className="recent__row" style={{ justifyContent: "center" }}>
          <span className="text-muted">No recent projects — create one to get started.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="recent">
      <div className="recent__head">
        <span style={{ flex: 2 }}>Name</span>
        <span style={{ flex: 1 }}>Type</span>
        <span style={{ flex: 1 }}>Modified</span>
        <span style={{ width: "110px" }} />
      </div>
      {recents.map((p) => (
        <div className="recent__row" key={p.projectPath}>
          <span className="text-sm" style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.projectPath}>
            {p.name}.graft
          </span>
          <span className="text-xs" style={{ flex: 1 }}>{p.dbType}</span>
          <span className="text-muted" style={{ flex: 1 }}>{relativeTime(p.modifiedAt)}</span>
          <span style={{ display: "flex", gap: "4px", width: "110px", justifyContent: "flex-end" }}>
            <button className="btn" style={{ fontSize: "10px", padding: "2px 8px" }} onClick={() => onOpen(p.projectPath)}>
              Open
            </button>
            <button className="btn" style={{ fontSize: "10px", padding: "2px 8px" }} title="Remove from list" onClick={() => onRemove(p.projectPath)}>
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
