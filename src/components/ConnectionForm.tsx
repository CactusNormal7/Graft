import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pickSqliteFile } from "../native";
import { DEFAULT_PORT, ENGINE_LABEL, connectionProblem, isServerEngine } from "../connection";
import { errorMessage } from "./sqlDiagnostics";
import type { ConnectionConfig, DbType, SavedConnection, SslMode } from "../types";

const ENGINES: DbType[] = ["sqlite", "postgres", "mysql"];

const SSL_MODES: { value: SslMode; label: string }[] = [
  { value: "disable", label: "Disable" },
  { value: "prefer", label: "Prefer" },
  { value: "require", label: "Require" },
  { value: "verify-full", label: "Verify" },
];

/** Whether the keychain holds a password for this (server) connection —
 *  e.g. after picking a saved connection. */
export function useStoredPassword(connection: ConnectionConfig): boolean {
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  useEffect(() => {
    if (!isServerEngine(connection.engine)) {
      setHasStoredPassword(false);
      return;
    }
    let isCurrent = true;
    invoke<boolean>("has_connection_password", { connectionId: connection.id })
      .then((stored) => isCurrent && setHasStoredPassword(stored))
      .catch((err) => console.error("has_connection_password:", err));
    return () => {
      isCurrent = false;
    };
  }, [connection.id, connection.engine]);
  return hasStoredPassword;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; version: string }
  | { status: "failed"; message: string };

interface ConnectionFormProps {
  value: ConnectionConfig;
  onChange: (next: ConnectionConfig) => void;
  /** Password typed in the form; stored in the keychain on submit. */
  password: string;
  onPasswordChange: (password: string) => void;
  /** A password is already in the keychain (editing an existing connection). */
  hasStoredPassword?: boolean;
  /** Placeholder of the SQLite file field when left empty. */
  sqlitePlaceholder?: string;
  /** Named connections offered as starting points. */
  savedConnections?: SavedConnection[];
  /** Name to save this connection under in the library ("" = don't). */
  saveName?: string;
  onSaveNameChange?: (name: string) => void;
}

/**
 * Engine + target of a connection, with a "Test connection" button. Used by
 * the new-project modal and the connection dialog. The password is kept
 * separately from the config so it can never end up in the project file.
 */
export function ConnectionForm({
  value,
  onChange,
  password,
  onPasswordChange,
  hasStoredPassword = false,
  sqlitePlaceholder = "Path to a .db / .sqlite file",
  savedConnections = [],
  saveName,
  onSaveNameChange,
}: ConnectionFormProps) {
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const update = (fields: Partial<ConnectionConfig>) => {
    setTest({ status: "idle" });
    onChange({ ...value, ...fields });
  };

  const isServer = isServerEngine(value.engine);
  const problem = connectionProblem(value);
  const canTest =
    test.status !== "testing" && problem === null && (isServer || Boolean(value.path?.trim()));

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      const version = await invoke<string>("test_connection", {
        connection: value,
        // Empty field while editing → test with the stored password.
        password: password || (hasStoredPassword ? null : ""),
      });
      setTest({ status: "ok", version });
    } catch (err) {
      setTest({ status: "failed", message: errorMessage(err) });
    }
  };

  const browseSqlite = async () => {
    const file = await pickSqliteFile();
    if (file) update({ path: file });
  };

  const pickSaved = (id: string) => {
    const saved = savedConnections.find((s) => s.connection.id === id);
    if (!saved) return;
    setTest({ status: "idle" });
    onPasswordChange("");
    onSaveNameChange?.(saved.name);
    // Same id → the password stored in the keychain for it is reused.
    onChange(saved.connection);
  };
  const pickedName = savedConnections.find((s) => s.connection.id === value.id)?.name;

  return (
    <>
      {savedConnections.length > 0 && (
        <div className="field">
          <label className="label">Saved connection</label>
          <select
            className="input"
            value={pickedName ? value.id : ""}
            onChange={(e) => pickSaved(e.currentTarget.value)}
          >
            <option value="">— New connection —</option>
            {savedConnections.map((saved) => (
              <option key={saved.connection.id} value={saved.connection.id}>
                {saved.name} · {ENGINE_LABEL[saved.connection.engine]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label className="label">Database engine</label>
        <div className="radio-group">
          {ENGINES.map((engine) => (
            <button
              key={engine}
              type="button"
              className={`radio ${value.engine === engine ? "radio--on" : ""}`}
              onClick={() => update({ engine })}
            >
              {ENGINE_LABEL[engine]}
            </button>
          ))}
        </div>
      </div>

      {!isServer && (
        <div className="field">
          <label className="label">Database file (SQLite)</label>
          <div className="connection-form__row">
            <input
              className="input connection-form__grow"
              value={value.path ?? ""}
              placeholder={sqlitePlaceholder}
              onChange={(e) => update({ path: e.currentTarget.value })}
            />
            <button type="button" className="btn" onClick={browseSqlite}>
              Browse…
            </button>
          </div>
        </div>
      )}

      {isServer && (
        <>
          <div className="connection-form__row">
            <div className="field connection-form__grow">
              <label className="label">Host</label>
              <input
                className="input"
                value={value.host ?? ""}
                placeholder="localhost"
                onChange={(e) => update({ host: e.currentTarget.value })}
              />
            </div>
            <div className="field connection-form__port">
              <label className="label">Port</label>
              <input
                className="input"
                inputMode="numeric"
                value={value.port ?? ""}
                placeholder={String(DEFAULT_PORT[value.engine as "postgres" | "mysql"])}
                onChange={(e) => {
                  const raw = e.currentTarget.value.trim();
                  update({ port: raw === "" ? undefined : Number(raw) });
                }}
              />
            </div>
          </div>
          <div className="field">
            <label className="label">
              Database{value.engine === "postgres" ? " (default: same as user)" : ""}
            </label>
            <input
              className="input"
              value={value.database ?? ""}
              onChange={(e) => update({ database: e.currentTarget.value })}
            />
          </div>
          <div className="connection-form__row">
            <div className="field connection-form__grow">
              <label className="label">User</label>
              <input
                className="input"
                value={value.user ?? ""}
                autoComplete="off"
                onChange={(e) => update({ user: e.currentTarget.value })}
              />
            </div>
            <div className="field connection-form__grow">
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                autoComplete="new-password"
                placeholder={hasStoredPassword ? "•••••• (stored — leave empty to keep)" : ""}
                onChange={(e) => {
                  setTest({ status: "idle" });
                  onPasswordChange(e.currentTarget.value);
                }}
              />
            </div>
          </div>
          <div className="field">
            <label className="label">SSL</label>
            <div className="radio-group">
              {SSL_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={`radio ${(value.sslMode ?? "prefer") === mode.value ? "radio--on" : ""}`}
                  onClick={() => update({ sslMode: mode.value })}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="text-muted">
              The password is stored in the system keychain, never in the project file.
            </div>
          </div>
        </>
      )}

      {onSaveNameChange && (
        <div className="field">
          <label className="label">Save as named connection (optional)</label>
          <input
            className="input"
            value={saveName ?? ""}
            placeholder="e.g. Production, Local dev"
            onChange={(e) => onSaveNameChange(e.currentTarget.value)}
          />
          <div className="text-muted">
            Reusable from other projects; projects sharing it share its stored password.
          </div>
        </div>
      )}

      <div className="connection-form__test">
        <button type="button" className="btn" disabled={!canTest} onClick={runTest}>
          {test.status === "testing" ? "Testing…" : "Test connection"}
        </button>
        {problem && <span className="text-muted">{problem}</span>}
        {test.status === "ok" && (
          <span className="connection-form__ok" title={test.version}>
            ✓ {test.version}
          </span>
        )}
        {test.status === "failed" && (
          <span className="connection-form__failed">{test.message}</span>
        )}
      </div>
    </>
  );
}
