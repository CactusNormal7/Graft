import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useGraftStore } from "../store/useGraftStore";
import type { DbType } from "../types";

const DB_TYPES: { value: DbType; label: string; enabled: boolean }[] = [
  { value: "sqlite", label: "SQLite", enabled: true },
  { value: "postgres", label: "PostgreSQL", enabled: false },
  { value: "mysql", label: "MySQL", enabled: false },
];

/** Modal to create a new project: name + location (default) + DB type. */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const createProject = useGraftStore((s) => s.createProject);

  const [name, setName] = useState("untitled");
  const [location, setLocation] = useState("");
  const [dbType, setDbType] = useState<DbType>("sqlite");
  /** Explicit SQLite file; empty = create <name>.db next to the project. */
  const [dbFile, setDbFile] = useState("");
  const [busy, setBusy] = useState(false);

  // Resolve the default location (~/Documents/Graft) on mount.
  useEffect(() => {
    invoke<string>("default_project_dir")
      .then(setLocation)
      .catch((e) => console.error("default_project_dir:", e));
  }, []);

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: "Choose a location" });
    if (typeof dir === "string") setLocation(dir);
  };

  const browseDbFile = async () => {
    const file = await openDialog({
      multiple: false,
      directory: false,
      title: "Select SQLite database",
      filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    if (typeof file === "string") setDbFile(file);
  };

  const safeName = name.trim();
  const canCreate = safeName.length > 0 && location.length > 0 && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      await createProject(safeName, location, dbType, dbType === "sqlite" ? dbFile : null);
      onClose();
    } catch (e) {
      console.error("createProject:", e);
      alert(`Could not create project:\n${String(e)}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__title">New project</div>

        <div className="field">
          <label className="label">Project name</label>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        <div className="field">
          <label className="label">Location</label>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={location}
              onChange={(e) => setLocation(e.currentTarget.value)}
            />
            <button className="btn" onClick={browse}>Browse…</button>
          </div>
          {safeName && location && (
            <div className="text-muted" style={{ marginTop: "4px" }}>
              → {location}/{safeName}.graft
            </div>
          )}
        </div>

        <div className="field">
          <label className="label">Database type</label>
          <div className="radio-group">
            {DB_TYPES.map((t) => (
              <button
                key={t.value}
                className={`radio ${dbType === t.value ? "radio--on" : ""}`}
                disabled={!t.enabled}
                title={t.enabled ? "" : "Available in v0.3"}
                onClick={() => t.enabled && setDbType(t.value)}
              >
                {t.label}
                {!t.enabled && <span className="text-muted"> · v0.3</span>}
              </button>
            ))}
          </div>
        </div>

        {dbType === "sqlite" && (
          <div className="field">
            <label className="label">Database file (SQLite)</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={dbFile}
                placeholder={safeName ? `Default: ${safeName}.db (created in location)` : "Default: <name>.db"}
                onChange={(e) => setDbFile(e.currentTarget.value)}
              />
              <button className="btn" onClick={browseDbFile}>Browse…</button>
            </div>
            <div className="text-muted" style={{ marginTop: "4px" }}>
              Pick an existing <code>.db</code>/<code>.sqlite</code> file, or leave empty to create a new one. Missing files are created on first query.
            </div>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-accent" disabled={!canCreate} onClick={submit}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
