// Core domain types for Graft.

import type { ErrorRange } from "./components/sqlDiagnostics";

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
  /** Capped at the backend fetch limit — see `total_rows`/`truncated`. */
  rows: Array<Array<string | number | boolean | null>>;
  rows_affected: number;
  elapsed_ms: number;
  /** Total rows the query produced (may exceed `rows.length`). Optional so
   *  results saved by older versions still parse. */
  total_rows?: number;
  /** True when the backend capped the returned rows. */
  truncated?: boolean;
}

export type ExecStatus = "idle" | "running" | "success" | "error";

/**
 * How the query result is rendered:
 *  - "table" : classic spreadsheet
 *  - "json"  : interactive JSON tree (fold/unfold like a JSON editor). When a
 *              parent→child join shape is detected, rows are re-nested into a
 *              relational document (parent object + child array); otherwise it's
 *              the flat array of `{ column: value }` row objects.
 *  - "chart" : plot the result — one X column, one or more Y series
 *
 * (Legacy "records"/"nested" values in old files are normalized to "json".)
 */
export type ResultView = "table" | "json" | "chart";

/** Map any stored value (incl. legacy "records"/"nested") to a valid view. */
export function normalizeResultView(v: unknown): ResultView {
  if (v === "table" || v === "chart") return v;
  if (v == null) return "table";
  return "json";
}

/** Chart kinds available in the "chart" result view. */
export type ChartType = "bar" | "line" | "area" | "pie";

/** How the "chart" view plots a result. Persisted with the block. */
export interface ChartConfig {
  type: ChartType;
  /** Column used for the X axis (or slice labels for pie). */
  xCol: string;
  /** One or more numeric columns plotted as series (pie uses the first). */
  yCols: string[];
}

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
  /** Last execution error and where it sits in `sql`, underlined in the
   *  editor (kept on the source block even when the result is routed to a
   *  linked block). Transient: reset on save and on the next edit. */
  editorError?: (ErrorRange & { message: string }) | null;
  resultView?: ResultView;
  /** Plot configuration for the "chart" result view. */
  chartConfig?: ChartConfig;
  /** When true, runBlock writes the result into a linked result block
   *  instead of embedding it in the source block's footer. */
  emitToBlock?: boolean;
  /** Id of the linked result block, if one has been spawned. */
  linkedResultId?: string | null;
  /** Collapsed to just the header (name + run button). */
  collapsed?: boolean;
  /** Height to restore when expanding again. */
  prevHeight?: number;
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
  /** Plot configuration for the "chart" result view. */
  chartConfig?: ChartConfig;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/**
 * Data carried by a "group" node — a colored container placed behind blocks.
 * Blocks dropped inside become React Flow children (they move with the group).
 */
export interface GroupBlockData {
  title: string;
  /** Container color (hex); applied as border + translucent fill. */
  color: string;
  /** Persisted container dimensions (set by NodeResizer). */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/**
 * Data of a "table" node: a schema table shown on the canvas, linked by
 * derived dashed edges to the SQL blocks that reference it.
 */
export interface TableNodeData {
  table: string;
  /** Namespace, when not the engine's default one. */
  schema?: string;
  [key: string]: unknown;
}

/** A named connection from the local library, reusable across projects
 *  (mirrors the Rust `SavedConnection`). */
export interface SavedConnection {
  name: string;
  connection: ConnectionConfig;
}

/** One column of a table/view, as introspected from the database. */
export interface ColumnInfo {
  name: string;
  data_type: string;
  notnull: boolean;
  pk: boolean;
}

/** `column` in this table references `to_table(to_column)`. */
export interface ForeignKey {
  column: string;
  to_table: string;
  to_column: string;
}

/** A table or view with the metadata the relation-aware features need. */
export interface TableInfo {
  name: string;
  /** Namespace, when not the engine's default one (Postgres `public`). */
  schema?: string;
  kind: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKey[];
  /** Absent from schemas cached by older versions. */
  indexes?: IndexInfo[];
  /** `SELECT` behind a view. */
  definition?: string;
}

/** An index of a table (primary keys included, `primary: true`). */
export interface IndexInfo {
  name: string;
  /** Columns, or expressions for expression indexes. */
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface TriggerInfo {
  name: string;
  table: string;
  schema?: string;
  /** BEFORE, AFTER or INSTEAD OF. */
  timing: string;
  /** INSERT / UPDATE / DELETE / TRUNCATE, comma-separated. */
  events: string;
  definition: string;
}

/** A stored procedure or function. */
export interface RoutineInfo {
  name: string;
  schema?: string;
  kind: "function" | "procedure";
  /** Parameter list, e.g. `customer_id integer`. */
  arguments: string;
  /** Return type (functions only). */
  returns?: string;
  definition: string;
}

/**
 * The database structure, introspected once at project creation/open and
 * refreshed after DDL. Cached in the `.graft` file so relations are available
 * without re-deriving them from every query result.
 */
export type DbSchema = TableInfo[];

/** What `introspect_schema` returns. */
export interface SchemaSnapshot {
  tables: TableInfo[];
  triggers: TriggerInfo[];
  routines: RoutineInfo[];
}

/** Schema objects that are not tables: introspected on open, not cached. */
export interface SchemaObjects {
  triggers: TriggerInfo[];
  routines: RoutineInfo[];
}

/** A saved "favorite" block: reusable SQL referenced as `{{name}}`. */
export interface Snippet {
  id: string;
  /** Reference name used in `{{name}}` placeholders. */
  name: string;
  sql: string;
  blockType: BlockType;
}

/** Database engine of a connection. */
export type DbType = "sqlite" | "postgres" | "mysql";

/** TLS policy of a server connection (mirrors the Rust `SslMode`). */
export type SslMode = "disable" | "prefer" | "require" | "verify-full";

/**
 * What a project connects to (mirrors the Rust `ConnectionConfig`). Saved in
 * the `.graft` file — hence no password: it lives in the OS keychain, under
 * the connection `id`.
 */
export interface ConnectionConfig {
  id: string;
  engine: DbType;
  /** SQLite database file. */
  path?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslMode?: SslMode;
}

/** A serialized canvas node (any kind). */
export interface NotebookNode {
  id: string;
  /** Absent in v1 files (all nodes were sqlBlock). */
  type?: "sqlBlock" | "resultBlock" | "group" | "tableNode";
  position: { x: number; y: number };
  /** Set on a block that lives inside a group container (v3+). */
  parentId?: string;
  data: SqlBlockData | ResultBlockData | GroupBlockData | TableNodeData;
}

/** A serialized edge. */
export interface NotebookEdge {
  id: string;
  source: string;
  target: string;
}

/** A serialized page (v4+). */
export interface NotebookPage {
  id: string;
  name: string;
  nodes: NotebookNode[];
  edges: NotebookEdge[];
}

/** On-disk shape of a `.graft` notebook file (JSON, Git-diff-friendly). */
export interface NotebookFile {
  /** 1 → original. 2 → linked result blocks + `type` field.
   *  3 → group (container) nodes + `parentId`. 4 → multiple pages.
   *  5 → cached db schema + snippets. 6 → `connection` (Postgres/MySQL).
   *  Loader tolerates all versions (v1–v3 = a single implicit page). */
  version: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  /** Engine, kept in v6+ for older readers (same as `connection.engine`). */
  dbType: DbType;
  /** SQLite file, kept in v6+ for older readers; null for server engines. */
  dbPath: string | null;
  /** v6+: the connection (no password). Absent → SQLite at `dbPath`. */
  connection?: ConnectionConfig;
  /** v5+: cached database structure, refreshed on DDL. */
  dbSchema?: DbSchema;
  /** v5+: saved favorite blocks, referenced as `{{name}}`. */
  snippets?: Snippet[];
  /** v1–v3: a single flat canvas. Absent in v4. */
  nodes?: NotebookNode[];
  edges?: NotebookEdge[];
  /** v4+: multiple named pages (Excel-like sheets). */
  pages?: NotebookPage[];
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
