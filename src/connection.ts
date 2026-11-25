/** Connections: what the project talks to. Pure helpers shared by the store,
 *  the connection form and the toolbar/status bar. Passwords are never part
 *  of a `ConnectionConfig` — they go to the OS keychain through the backend. */
import { basename } from "./paths";
import type { ConnectionConfig, DbType, NotebookFile } from "./types";

export const ENGINE_LABEL: Record<DbType, string> = {
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

export const DEFAULT_PORT: Record<Exclude<DbType, "sqlite">, number> = {
  postgres: 5432,
  mysql: 3306,
};

/** Id given to the SQLite connection of projects saved before v6. */
const LEGACY_SQLITE_ID = "sqlite-legacy";

let connectionSeq = 0;
export function newConnectionId(): string {
  return `conn-${Date.now().toString(36)}-${(connectionSeq++).toString(36)}`;
}

export function isServerEngine(engine: DbType): engine is "postgres" | "mysql" {
  return engine !== "sqlite";
}

/** The project's connection, from a v6 file or a legacy `dbType`/`dbPath`. */
export function connectionFromFile(file: NotebookFile): ConnectionConfig | null {
  if (file.connection) return file.connection;
  if ((file.dbType ?? "sqlite") === "sqlite" && file.dbPath) {
    return { id: LEGACY_SQLITE_ID, engine: "sqlite", path: file.dbPath };
  }
  return null;
}

/** Short label for the toolbar / status bar — never contains a secret. */
export function connectionLabel(connection: ConnectionConfig | null): string {
  if (!connection) return "No database";
  if (connection.engine === "sqlite") return connection.path ? basename(connection.path) : "SQLite";
  const port = connection.port ?? DEFAULT_PORT[connection.engine];
  return `${connection.user ?? ""}@${connection.host ?? ""}:${port}/${connection.database ?? ""}`;
}

/** First missing field of a connection being edited, or null when usable. */
export function connectionProblem(connection: ConnectionConfig): string | null {
  if (connection.engine === "sqlite") return null; // empty = <project>.db
  if (!connection.host?.trim()) return "Host is required.";
  if (!connection.user?.trim()) return "User is required.";
  if (connection.engine === "mysql" && !connection.database?.trim()) {
    return "Database is required for MySQL.";
  }
  if (connection.port !== undefined && !(connection.port > 0 && connection.port < 65536)) {
    return "Port must be between 1 and 65535.";
  }
  return null;
}
