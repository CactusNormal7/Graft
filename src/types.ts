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
  kind: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKey[];
}

/**
 * The database structure, introspected once at project creation/open and
 * refreshed after DDL. Cached in the `.graft` file so relations are available
 * without re-deriving them from every query result.
 */
export type DbSchema = TableInfo[];

/** A saved "favorite" block: reusable SQL referenced as `{{name}}`. */
export interface Snippet {
  id: string;
  /** Reference name used in `{{name}}` placeholders. */
  name: string;
  sql: string;
  blockType: BlockType;
}

/** Database engine for a connection. Only SQLite is functional in v0.1. */
export type DbType = "sqlite" | "postgres" | "mysql";

/** A serialized canvas node (any kind). */
export interface NotebookNode {
  id: string;
  /** Absent in v1 files (all nodes were sqlBlock). */
  type?: "sqlBlock" | "resultBlock" | "group";
  position: { x: number; y: number };
  /** Set on a block that lives inside a group container (v3+). */
  parentId?: string;
  data: SqlBlockData | ResultBlockData | GroupBlockData;
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
   *  5 → cached db schema + snippets.
   *  Loader tolerates all versions (v1–v3 = a single implicit page). */
  version: 1 | 2 | 3 | 4 | 5;
  name: string;
  dbType: DbType;
  dbPath: string | null;
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
