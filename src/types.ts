// Core domain types for Graft.

/** The differentiated SQL block kinds Graft targets (see roadmap v1.0). */
export type BlockType =
  | "query"
  | "migration"
  | "procedure"
  | "trigger"
  | "view"
  | "script";

/** Mirrors the Rust `QueryResult` returned by the `execute_sql` command. */
export interface QueryResult {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rows_affected: number;
  elapsed_ms: number;
}

export type ExecStatus = "idle" | "running" | "success" | "error";

/**
 * Data carried by each SQL block node on the canvas. The index signature
 * satisfies React Flow v12's `Record<string, unknown>` node-data constraint.
 */
export interface SqlBlockData {
  title: string;
  blockType: BlockType;
  sql: string;
  status: ExecStatus;
  result: QueryResult | null;
  error: string | null;
  [key: string]: unknown;
}

/** Database engine for a connection. Only SQLite is functional in v0.1. */
export type DbType = "sqlite" | "postgres" | "mysql";

/** On-disk shape of a `.graft` notebook file (JSON, Git-diff-friendly). */
export interface NotebookFile {
  version: 1;
  name: string;
  dbType: DbType;
  dbPath: string | null;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: SqlBlockData;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

/** A recently-opened project, persisted locally so it can be reopened. */
export interface RecentProject {
  name: string;
  /** Absolute path to the `.graft` file. */
  projectPath: string;
  dbType: DbType;
  dbPath: string | null;
  /** ISO timestamp of last open/save. */
  modifiedAt: string;
}
