import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGraftStore } from "../store/useGraftStore";
import { showError } from "../dialogs/appDialogs";
import { connectionProblem, isServerEngine, newConnectionId } from "../connection";
import { ConnectionForm } from "./ConnectionForm";
import type { ConnectionConfig } from "../types";

/** Edit the open project's connection (toolbar connection button). */
export function ConnectionModal({ onClose }: { onClose: () => void }) {
  const current = useGraftStore((s) => s.connection);
  const updateConnection = useGraftStore((s) => s.updateConnection);

  const [connection, setConnection] = useState<ConnectionConfig>(
    () => current ?? { id: newConnectionId(), engine: "sqlite" },
  );
  const [password, setPassword] = useState("");
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const projectPath = useGraftStore((s) => s.projectPath);
  const [allowClaudeWrites, setAllowClaudeWrites] = useState(false);

  useEffect(() => {
    if (!projectPath) return;
    invoke<boolean>("get_mcp_writes", { path: projectPath })
      .then(setAllowClaudeWrites)
      .catch((e) => void showError("Could not read the Claude permissions", String(e)));
  }, [projectPath]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isServerEngine(connection.engine)) return;
    invoke<boolean>("has_connection_password", { connectionId: connection.id })
      .then(setHasStoredPassword)
      .catch((e) => void showError("Could not read the keychain", String(e)));
  }, [connection.id, connection.engine]);

  const isUsable =
    connectionProblem(connection) === null &&
    (isServerEngine(connection.engine) || Boolean(connection.path?.trim()));

  const save = async () => {
    if (!isUsable) return;
    setBusy(true);
    try {
      await updateConnection(connection, password || undefined);
      if (projectPath) await invoke("set_mcp_writes", { path: projectPath, allow: allowClaudeWrites });
      onClose();
    } catch (e) {
      void showError("Could not update the connection", String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__title">Connection</div>
        <ConnectionForm
          value={connection}
          onChange={setConnection}
          password={password}
          onPasswordChange={setPassword}
          hasStoredPassword={hasStoredPassword}
        />
        <label className="connection-form__permission">
          <input
            type="checkbox"
            checked={allowClaudeWrites}
            onChange={(e) => setAllowClaudeWrites(e.currentTarget.checked)}
          />
          <span>
            Allow Claude (MCP) to modify this database
            <span className="text-muted">
              {" "}— off: Claude can only read. Stored on this computer, not in the project file.
            </span>
          </span>
        </label>
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-accent" disabled={!isUsable || busy} onClick={save}>
            {busy ? "Connecting…" : "Save connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
