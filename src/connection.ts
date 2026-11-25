/** Connections: what the project talks to. Pure helpers shared by the store,
 *  the connection form and the toolbar/status bar. Passwords are never part
 *  of a `ConnectionConfig` — they go to the OS keychain through the backend. */
import { basename } from "./paths";
import type { ConnectionConfig, DbType, NotebookFile, SslMode } from "./types";

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

/** Fields extracted from a connection URL; the password stays apart from the config. */
export interface ParsedConnectionUrl {
  fields: Pick<ConnectionConfig, "engine" | "host" | "port" | "database" | "user" | "sslMode">;
  password?: string;
}

const URL_SCHEME_ENGINE: Record<string, Exclude<DbType, "sqlite">> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "mariadb:": "mysql",
};

/** `sslmode` (libpq) and `ssl-mode` (MySQL) values understood by Graft. */
const URL_SSL_MODE: Record<string, SslMode> = {
  disable: "disable",
  disabled: "disable",
  allow: "prefer",
  prefer: "prefer",
  preferred: "prefer",
  require: "require",
  required: "require",
  "verify-ca": "verify-full",
  verify_ca: "verify-full",
  "verify-full": "verify-full",
  verify_identity: "verify-full",
};

function decodeUrlPart(part: string): string | undefined {
  return part === "" ? undefined : decodeURIComponent(part);
}

function sslModeFromParams(params: URLSearchParams): SslMode | undefined {
  const raw = params.get("sslmode") ?? params.get("ssl-mode");
  return raw === null ? undefined : URL_SSL_MODE[raw.toLowerCase()];
}

/**
 * Splits a `postgresql://user:pass@host:5432/db?sslmode=require` (or
 * `mysql://…`) URL into form fields. Returns an error message for anything
 * that is not a single-host Postgres/MySQL URL.
 */
export function parseConnectionUrl(input: string): ParsedConnectionUrl | { error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: "Not a valid URL (expected postgresql://user:password@host:5432/db)." };
  }
  const engine = URL_SCHEME_ENGINE[url.protocol];
  if (!engine) return { error: "Use a postgresql:// or mysql:// URL." };
  if (!url.hostname) return { error: "The URL has no host." };
  if (url.hostname.includes(",")) return { error: "Multi-host URLs are not supported." };

  const database = decodeUrlPart(url.pathname.replace(/^\//, ""));
  return {
    fields: {
      engine,
      host: decodeUrlPart(url.hostname.replace(/^\[(.*)\]$/, "$1")), // IPv6 brackets
      port: url.port === "" ? undefined : Number(url.port),
      database,
      user: decodeUrlPart(url.username),
      sslMode: sslModeFromParams(url.searchParams),
    },
    password: decodeUrlPart(url.password),
  };
}
