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
 * How the query result is rendered:
 *  - "table"   : classic spreadsheet
 *  - "records" : one card per row, key/value lines (no horizontal scroll)
 *  - "nested"  : group flat join results back into a JSON-like tree using
 *                column-alias conventions (`parent.child`, `array[].field`)
 */
export type ResultView = "table" | "records" | "nested";

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
  resultView?: ResultView;
  /** When true, runBlock writes the result into a linked result block
   *  instead of embedding it in the source block's footer. */
  emitToBlock?: boolean;
  /** Id of the linked result block, if one has been spawned. */
  linkedResultId?: string | null;
  /** Persisted block dimensions (set by NodeResizer). Height is optional so
   *  blocks can auto-grow until the user explicitly resizes vertically. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/**
 * Data carried by a "result" node — a read-only companion block that
 * displays the last result of a source SQL block. Created on demand when
 * `SqlBlockData.emitToBlock` is true.
 */
export interface ResultBlockData {
  sourceId: string;
  sourceTitle: string;
  status: ExecStatus;
  result: QueryResult | null;
  error: string | null;
  resultView?: ResultView;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/** Database engine for a connection. Only SQLite is functional in v0.1. */
export type DbType = "sqlite" | "postgres" | "mysql";

/** On-disk shape of a `.graft` notebook file (JSON, Git-diff-friendly). */
export interface NotebookFile {
  /** Bumped to 2 when linked result blocks + `type` field were added.
   *  Loader tolerates version 1 (no `type` → treated as sqlBlock). */
  version: 1 | 2;
  name: string;
  dbType: DbType;
  dbPath: string | null;
  nodes: Array<{
    id: string;
    /** Absent in v1 files (all nodes were sqlBlock). */
    type?: "sqlBlock" | "resultBlock";
    position: { x: number; y: number };
    data: SqlBlockData | ResultBlockData;
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
