import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickDirectory } from "../native";
import { useGraftStore } from "../store/useGraftStore";
import { showError } from "../dialogs/appDialogs";
import { connectionProblem, newConnectionId } from "../connection";
import { ConnectionForm, useStoredPassword } from "./ConnectionForm";
import type { ConnectionConfig } from "../types";

/** Modal to create a new project: name + location (default) + connection. */
export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const createProject = useGraftStore((s) => s.createProject);
  const preset = useGraftStore((s) => s.newProjectConnection);
  const savedConnections = useGraftStore((s) => s.savedConnections);
  const saveNamedConnection = useGraftStore((s) => s.saveNamedConnection);

  const [name, setName] = useState("untitled");
  const [location, setLocation] = useState("");
  const [connection, setConnection] = useState<ConnectionConfig>(
    () => preset ?? { id: newConnectionId(), engine: "sqlite" },
  );
  const [password, setPassword] = useState("");
  const [saveName, setSaveName] = useState(
    () => savedConnections.find((s) => s.connection.id === preset?.id)?.name ?? "",
  );
  const hasStoredPassword = useStoredPassword(connection);
  const [busy, setBusy] = useState(false);

  // Resolve the default location (~/Documents/Graft) on mount.
  useEffect(() => {
    invoke<string>("default_project_dir")
      .then(setLocation)
      .catch((e) => void showError("Could not resolve the default location", String(e)));
  }, []);

  const browse = async () => {
    const dir = await pickDirectory();
    if (dir) setLocation(dir);
  };

  const safeName = name.trim();
  const canCreate =
    safeName.length > 0 && location.length > 0 && connectionProblem(connection) === null && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const isServer = connection.engine !== "sqlite";
      const created = await createProject(
        safeName,
        location,
        isServer ? connection : { id: connection.id, engine: "sqlite", path: connection.path?.trim() },
        isServer && password ? password : undefined,
      );
      // Not created = the user kept their unsaved changes: stay on the modal.
      if (!created) {
        setBusy(false);
        return;
      }
      onClose();
      // The project's connection is final now (a default SQLite path is only
      // chosen at creation).
      const createdConnection = useGraftStore.getState().connection;
      if (saveName.trim() && createdConnection) {
        await saveNamedConnection(saveName, createdConnection).catch(
          (e) => void showError("Could not save the named connection", String(e)),
        );
      }
    } catch (e) {
      void showError("Could not create the project", String(e));
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
          <div className="connection-form__row">
            <input
              className="input connection-form__grow"
              value={location}
              onChange={(e) => setLocation(e.currentTarget.value)}
            />
            <button className="btn" onClick={browse}>Browse…</button>
          </div>
          {safeName && location && (
            <div className="text-muted">→ {location}/{safeName}.graft</div>
          )}
        </div>

        <ConnectionForm
          value={connection}
          onChange={setConnection}
          password={password}
          onPasswordChange={setPassword}
          hasStoredPassword={hasStoredPassword}
          savedConnections={savedConnections}
          saveName={saveName}
          onSaveNameChange={setSaveName}
          sqlitePlaceholder={
            safeName ? `Default: ${safeName}.db (created in location)` : "Default: <name>.db"
          }
        />

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
