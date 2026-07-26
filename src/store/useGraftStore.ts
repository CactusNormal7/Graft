import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { insertIntoEditor } from "../canvas/editorRegistry";
import { expandSnippets } from "./snippets";
import { generateInserts, jsonToInserts, warningsHeader } from "../canvas/orm";
import { quoteIdent } from "../sqlFormat";
import type {
  BlockType,
  ChartConfig,
  DbSchema,
  DbType,
  GroupBlockData,
  NotebookEdge,
  NotebookFile,
  NotebookNode,
  QueryResult,
  RecentProject,
  ResultBlockData,
  ResultView,
  Snippet,
  SqlBlockData,
} from "../types";

/** A canvas node whose data is a SQL block. */
export type SqlNode = Node<SqlBlockData, "sqlBlock">;

/** A canvas node whose data is the linked result of a SQL block. */
export type ResultNode = Node<ResultBlockData, "resultBlock">;

/** A colored container node; blocks dropped inside become its children. */
export type GroupNode = Node<GroupBlockData, "group">;

/** Anything that can live on the canvas. */
export type AnyNode = SqlNode | ResultNode | GroupNode;

/** A page (Excel-like sheet): its own canvas of nodes + edges. */
export interface Page {
  id: string;
  name: string;
  nodes: AnyNode[];
  edges: Edge[];
}

const isSqlNode = (n: AnyNode): n is SqlNode => n.type === "sqlBlock";
const isResultNode = (n: AnyNode): n is ResultNode => n.type === "resultBlock";
const isGroupNode = (n: AnyNode): n is GroupNode => n.type === "group";

/** Keep group (parent) nodes ahead of blocks in the array — React Flow requires
 *  a parent to precede its children, and it makes groups render behind. */
function sortGroupsFirst(nodes: AnyNode[]): AnyNode[] {
  const groups = nodes.filter(isGroupNode);
  if (groups.length === 0) return nodes;
  return [...groups, ...nodes.filter((n) => !isGroupNode(n))];
}

/** Default block size. Set explicitly on every node so content — a wide result
 *  table, or a generated script with thousands of lines — scrolls *inside* the
 *  block instead of stretching it across the canvas. Freely resizable after. */
const DEFAULT_BLOCK_WIDTH = 520;
const DEFAULT_BLOCK_HEIGHT = 300;
/** Linked result blocks get a bit more room (they're all result). */
const DEFAULT_RESULT_WIDTH = 640;
const DEFAULT_RESULT_HEIGHT = 360;

/** Default container size for a new group. */
const DEFAULT_GROUP_WIDTH = 480;
const DEFAULT_GROUP_HEIGHT = 340;

/** Container color palette offered on group creation (cycled). */
const GROUP_COLORS = [
  "#6ea8fe", // blue
  "#4ade80", // green
  "#fbbf74", // amber
  "#f0819b", // pink
  "#c9a8ff", // violet
  "#5eead4", // teal
];
let groupColorSeq = 0;

let nodeSeq = 0;
const nextId = () => `block-${Date.now()}-${nodeSeq++}`;

let pageSeq = 0;
const nextPageId = () => `page-${Date.now()}-${pageSeq++}`;

/** Max rows pulled back from the backend per run. The UI paginates, so fetching
 *  (and IPC-serializing) an entire huge result set is wasted work. */
export const MAX_FETCH_ROWS = 5000;


const DEFAULT_SQL: Record<BlockType, string> = {
  query: "SELECT 1 AS hello;",
  migration: "-- migration\nCREATE TABLE example (id INTEGER PRIMARY KEY, name TEXT);",
  procedure: "-- stored procedure",
  trigger: "-- trigger",
  view: "CREATE VIEW v_example AS SELECT 1;",
  script: "-- script",
};

/** Which top-level screen is shown (see the wireframe). */
export type View = "home" | "canvas";

// --- Recent projects, persisted in localStorage -----------------------------
const RECENTS_KEY = "graft.recentProjects";
const RECENTS_MAX = 12;

function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

function persistRecents(list: RecentProject[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

interface GraftState {
  view: View;
  /** Working copy of the ACTIVE page's nodes/edges. The `pages` array holds the
   *  snapshot for every page; the active one is synced from here on switch/save
   *  (see `commitActivePage`). Components keep using `nodes`/`edges` unchanged. */
  nodes: AnyNode[];
  edges: Edge[];
  pages: Page[];
  activePageId: string;

  // Current project
  projectName: string | null;
  /** Absolute path to the current `.graft` file, or null if unsaved. */
  projectPath: string | null;
  dbType: DbType;
  /** Path to the connected database file (SQLite), or null if none. */
  dbPath: string | null;

  /** Introspected schema: table/view name → column names (for autocompletion).
   *  Derived from `dbSchema` — kept flat because that's what CodeMirror and the
   *  sidebar consume. */
  schema: Record<string, string[]>;
  /** Full database structure (types, PKs, foreign keys). Introspected at
   *  project create/open, refreshed after DDL, and cached in the `.graft`. */
  dbSchema: DbSchema;

  /** Saved favorite blocks, usable as `{{name}}` inside other queries. */
  snippets: Snippet[];

  /** Id of the block whose editor last had focus — used by the sidebar
   *  to know where to insert clicked table/column names. */
  focusedBlockId: string | null;

  recentProjects: RecentProject[];

  onNodesChange: (changes: NodeChange<AnyNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  goHome: () => void;
  createProject: (
    name: string,
    dir: string,
    dbType: DbType,
    dbPathOverride?: string | null,
  ) => Promise<void>;
  openProjectByPath: (projectPath: string) => Promise<void>;
  openProjectFromDialog: () => Promise<void>;
  removeRecent: (projectPath: string) => void;

  // --- Pages (Excel-like sheets) ---
  addPage: () => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  switchPage: (id: string) => void;

  // --- Favorites / snippets ---
  /** Save a block's SQL as a reusable favorite under `name`. */
  saveBlockAsSnippet: (blockId: string, name: string) => void;
  deleteSnippet: (id: string) => void;
  /** Insert a `{{name}}` reference into the focused block's editor. */
  insertSnippetRef: (id: string) => void;
  /** Create a new block seeded with the snippet's SQL. */
  addBlockFromSnippet: (id: string) => void;

  // --- Relational (ORM) bridge: nested data ⇄ multi-table INSERTs ---
  /** Generate multi-table INSERTs from a block's result into a new script block. */
  generateInserts: (blockId: string) => void;
  /** Same, but to the clipboard. */
  copyInserts: (blockId: string) => void;
  /** Same, but written to a `.sql` file chosen by the user. */
  exportInserts: (blockId: string) => Promise<void>;
  /** Import a nested `.json` (→ multi-table INSERTs) or a `.sql` file. */
  importDataFile: () => Promise<void>;

  refreshSchema: () => Promise<void>;
  addBlock: (blockType: BlockType) => void;
  /** Collapse/expand a block down to its header (name + run). */
  toggleCollapse: (id: string) => void;
  /** Create a query block pre-filled with `SELECT * FROM <table> LIMIT 100`
   *  and run it immediately (double-click a table in the sidebar). */
  addSelectBlock: (table: string) => void;

  // --- Group containers ---
  addGroup: () => void;
  renameGroup: (id: string, title: string) => void;
  setGroupColor: (id: string, color: string) => void;
  /** Delete a group but keep its blocks — they're detached (parentId cleared,
   *  positions converted back to absolute) rather than removed. */
  deleteGroup: (id: string) => void;
  /** Attach a block to a group (or detach when parentId is null), fixing the
   *  block's position (relative when attached, absolute when detached). */
  reparentNode: (
    id: string,
    parentId: string | null,
    position: { x: number; y: number },
  ) => void;
  updateSql: (id: string, sql: string) => void;
  updateTitle: (id: string, title: string) => void;
  setResultView: (id: string, view: ResultView) => void;
  setChartConfig: (id: string, config: ChartConfig) => void;
  setEmitToBlock: (id: string, enabled: boolean) => void;
  resizeBlock: (id: string, width: number, height: number) => void;
  duplicateBlock: (id: string) => void;
  deleteBlock: (id: string) => void;
  setFocusedBlock: (id: string | null) => void;
  runBlock: (id: string) => Promise<void>;
  runAll: () => Promise<void>;

  saveNotebook: () => Promise<void>;
}

/** Immutably patch the data of a single node (works for any node kind — the
 *  caller is responsible for passing keys valid for that node's data). */
function patchNode(
  nodes: AnyNode[],
  id: string,
  patch: Record<string, unknown>,
): AnyNode[] {
  return nodes.map((n) =>
    n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AnyNode) : n,
  );
}

/** Flatten the rich schema into the `table → column names` map CodeMirror and
 *  the sidebar consume. */
function flattenSchema(dbSchema: DbSchema): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of dbSchema) out[t.name] = t.columns.map((c) => c.name);
  return out;
}

/** The result shown for a block: its own, or the linked result block's. */
function resultOf(state: GraftState, blockId: string): QueryResult | null {
  const node = state.nodes.find((n) => n.id === blockId);
  if (!node) return null;
  if (isResultNode(node)) return node.data.result;
  if (!isSqlNode(node)) return null;
  if (node.data.emitToBlock && node.data.linkedResultId) {
    const linked = state.nodes.find((n) => n.id === node.data.linkedResultId);
    if (linked && isResultNode(linked)) return linked.data.result;
  }
  return node.data.result;
}

/** Build the INSERT script for a block's result, or null when there's nothing
 *  usable (the caller stays silent rather than spawning an empty block). */
function buildInsertScript(
  state: GraftState,
  blockId: string,
): { title: string; sql: string } | null {
  const result = resultOf(state, blockId);
  if (!result || result.columns.length === 0 || result.rows.length === 0) {
    alert("Run a query that returns rows first.");
    return null;
  }
  const { sql, warnings } = generateInserts(result, state.dbSchema);
  if (!sql.trim()) {
    alert(`Nothing to generate:\n${warnings.join("\n")}`);
    return null;
  }
  const node = state.nodes.find((n) => n.id === blockId);
  const base =
    node && isSqlNode(node)
      ? node.data.title
      : node && isResultNode(node)
      ? node.data.sourceTitle
      : "result";
  return { title: `INSERTs — ${base}`, sql: warningsHeader(warnings) + sql };
}

/** Drop a generated SQL script onto the canvas as a new `script` block. */
function spawnScriptBlock(
  get: () => GraftState,
  set: (partial: Partial<GraftState>) => void,
  title: string,
  sql: string,
) {
  const count = get().nodes.length;
  const id = nextId();
  const node: SqlNode = {
    id,
    type: "sqlBlock",
    position: { x: 80 + (count % 4) * 400, y: 80 + Math.floor(count / 4) * 280 },
    width: DEFAULT_BLOCK_WIDTH,
    height: DEFAULT_BLOCK_HEIGHT,
    data: {
      title,
      blockType: "script",
      sql,
      status: "idle",
      result: null,
      error: null,
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
    },
  };
  set({ nodes: [...get().nodes, node], focusedBlockId: id });
}

/** Sync the working copy (top-level nodes/edges) back into the active page. */
function commitActivePage(state: GraftState): Page[] {
  return state.pages.map((p) =>
    p.id === state.activePageId
      ? { ...p, nodes: state.nodes, edges: state.edges }
      : p,
  );
}

function serializeNodes(nodes: AnyNode[]): NotebookNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    ...(n.parentId ? { parentId: n.parentId } : {}),
    // Reset transient execution state (blocks only) so saved files stay
    // diff-friendly. Group nodes carry no execution state.
    data:
      n.type === "group"
        ? n.data
        : { ...n.data, status: "idle", result: null, error: null },
  })) as NotebookNode[];
}

function serializeEdges(edges: Edge[]): NotebookEdge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

/** Rebuild canvas nodes from serialized form (restores dims, parentId; keeps
 *  groups ahead of blocks as React Flow requires). */
function deserializeNodes(rawNodes: NotebookNode[] | undefined): AnyNode[] {
  return sortGroupsFirst(
    (rawNodes ?? []).map((n) => {
      const kind = n.type ?? "sqlBlock";
      const d = n.data as SqlBlockData & ResultBlockData & GroupBlockData;
      // Always give nodes explicit dimensions: files saved before sizes were
      // set would otherwise measure themselves against their content and blow
      // up (a wide result table, a long generated script…).
      const isGroup = kind === "group";
      const isResult = kind === "resultBlock";
      const fallbackWidth = isGroup
        ? DEFAULT_GROUP_WIDTH
        : isResult
        ? DEFAULT_RESULT_WIDTH
        : DEFAULT_BLOCK_WIDTH;
      const fallbackHeight = isGroup
        ? DEFAULT_GROUP_HEIGHT
        : isResult
        ? DEFAULT_RESULT_HEIGHT
        : DEFAULT_BLOCK_HEIGHT;
      // A collapsed block must stay header-sized — never force a height on it.
      const collapsed = d.collapsed === true;
      const dims = {
        width: d.width ?? fallbackWidth,
        ...(collapsed ? {} : { height: d.height ?? fallbackHeight }),
      };
      return {
        id: n.id,
        type: kind,
        position: n.position,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        data: n.data,
        ...dims,
      } as AnyNode;
    }),
  );
}

function deserializeEdges(rawEdges: NotebookEdge[] | undefined): Edge[] {
  return (rawEdges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

/** Read a notebook file (any version) into the page list. Pre-v4 flat files
 *  become a single "Page 1". */
function pagesFromFile(file: NotebookFile): Page[] {
  if (file.pages && file.pages.length > 0) {
    return file.pages.map((p) => ({
      id: p.id,
      name: p.name,
      nodes: deserializeNodes(p.nodes),
      edges: deserializeEdges(p.edges),
    }));
  }
  return [
    {
      id: nextPageId(),
      name: "Page 1",
      nodes: deserializeNodes(file.nodes),
      edges: deserializeEdges(file.edges),
    },
  ];
}

/** Build the on-disk notebook shape (v4, paged) from the current state. */
function serializeNotebook(state: GraftState): NotebookFile {
  const pages = commitActivePage(state);
  return {
    version: 5,
    name: state.projectName ?? "untitled",
    dbType: state.dbType,
    dbPath: state.dbPath,
    // Cached so relations are known at open without re-introspecting.
    dbSchema: state.dbSchema,
    snippets: state.snippets,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      nodes: serializeNodes(p.nodes),
      edges: serializeEdges(p.edges),
    })),
  };
}

const INITIAL_PAGE_ID = "page-initial";

export const useGraftStore = create<GraftState>((set, get) => ({
  view: "home",
  nodes: [],
  edges: [],
  pages: [{ id: INITIAL_PAGE_ID, name: "Page 1", nodes: [], edges: [] }],
  activePageId: INITIAL_PAGE_ID,
  projectName: null,
  projectPath: null,
  dbType: "sqlite",
  dbPath: null,
  schema: {},
  dbSchema: [],
  snippets: [],
  focusedBlockId: null,
  recentProjects: loadRecents(),

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) =>
    set({ edges: addEdge(connection, get().edges) }),

  goHome: () => set({ view: "home" }),

  addPage: () => {
    const pages = commitActivePage(get());
    const id = nextPageId();
    set({
      pages: [...pages, { id, name: `Page ${pages.length + 1}`, nodes: [], edges: [] }],
      activePageId: id,
      nodes: [],
      edges: [],
      focusedBlockId: null,
    });
  },

  renamePage: (id, name) => {
    const next = name.trim();
    if (!next) return;
    set({
      pages: get().pages.map((p) => (p.id === id ? { ...p, name: next } : p)),
    });
  },

  deletePage: (id) => {
    const state = get();
    if (state.pages.length <= 1) return; // always keep at least one page
    const pages = commitActivePage(state).filter((p) => p.id !== id);
    if (state.activePageId === id) {
      const target = pages[0];
      set({
        pages,
        activePageId: target.id,
        nodes: target.nodes,
        edges: target.edges,
        focusedBlockId: null,
      });
    } else {
      set({ pages });
    }
  },

  switchPage: (id) => {
    const state = get();
    if (id === state.activePageId) return;
    const pages = commitActivePage(state);
    const target = pages.find((p) => p.id === id);
    if (!target) return;
    set({
      pages,
      activePageId: id,
      nodes: target.nodes,
      edges: target.edges,
      focusedBlockId: null,
    });
  },

  removeRecent: (projectPath) => {
    const next = get().recentProjects.filter((p) => p.projectPath !== projectPath);
    persistRecents(next);
    set({ recentProjects: next });
  },

  createProject: async (name, dir, dbType, dbPathOverride) => {
    const paths = await invoke<{ projectPath: string; dbPath: string }>(
      "create_project_paths",
      { dir, name },
    );
    // SQLite: use the chosen existing/explicit file if given, else create
    // <name>.db next to the project. Other engines have no file path (v0.3).
    const dbPath =
      dbType === "sqlite"
        ? dbPathOverride && dbPathOverride.trim()
          ? dbPathOverride.trim()
          : paths.dbPath
        : null;

    const pageId = nextPageId();
    set({
      view: "canvas",
      nodes: [],
      edges: [],
      pages: [{ id: pageId, name: "Page 1", nodes: [], edges: [] }],
      activePageId: pageId,
      projectName: name,
      projectPath: paths.projectPath,
      dbType,
      dbPath,
      dbSchema: [],
      schema: {},
      snippets: [],
    });

    // Introspect first so the very first save already carries the schema
    // snapshot (tables, columns, PKs, foreign keys).
    await get().refreshSchema();

    // Persist the (empty) project immediately so it is reopenable.
    await invoke("save_notebook", {
      path: paths.projectPath,
      contents: JSON.stringify(serializeNotebook(get()), null, 2),
    });
    touchRecent(get, set, {
      name,
      projectPath: paths.projectPath,
      dbType,
      dbPath,
    });
  },

  openProjectByPath: async (projectPath) => {
    try {
      const contents = await invoke<string>("load_notebook", { path: projectPath });
      const file = JSON.parse(contents) as NotebookFile;
      const pages = pagesFromFile(file);
      const active = pages[0];
      set({
        view: "canvas",
        projectName: file.name ?? "untitled",
        projectPath,
        dbType: file.dbType ?? "sqlite",
        dbPath: file.dbPath,
        pages,
        activePageId: active.id,
        nodes: active.nodes,
        edges: active.edges,
        // Use the cached structure immediately; refreshSchema() below then
        // reconciles it with the database as it is right now.
        dbSchema: file.dbSchema ?? [],
        schema: flattenSchema(file.dbSchema ?? []),
        snippets: file.snippets ?? [],
      });
      touchRecent(get, set, {
        name: file.name ?? "untitled",
        projectPath,
        dbType: file.dbType ?? "sqlite",
        dbPath: file.dbPath,
      });
      void get().refreshSchema();
    } catch (err) {
      console.error("Failed to open project:", err);
      // Prune a project file that no longer exists / can't be read.
      get().removeRecent(projectPath);
      alert(`Could not open project:\n${projectPath}\n\n${String(err)}`);
    }
  },

  openProjectFromDialog: async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      title: "Open project",
      filters: [{ name: "Graft project", extensions: ["graft"] }],
    });
    if (typeof path === "string") await get().openProjectByPath(path);
  },

  refreshSchema: async () => {
    const { dbPath } = get();
    if (!dbPath) {
      set({ schema: {}, dbSchema: [] });
      return;
    }
    try {
      const dbSchema = await invoke<DbSchema>("introspect_schema", { dbPath });
      set({ dbSchema, schema: flattenSchema(dbSchema) });
    } catch (err) {
      console.error("introspect_schema:", err);
    }
  },

  addBlock: (blockType) => {
    const sqlCount = get().nodes.filter(isSqlNode).length;
    const count = get().nodes.length;
    const node: SqlNode = {
      id: nextId(),
      type: "sqlBlock",
      // Stagger new blocks so they don't stack exactly on top of each other.
      position: { x: 80 + (count % 4) * 400, y: 80 + Math.floor(count / 4) * 280 },
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
      data: {
        title: `${blockType[0].toUpperCase()}${blockType.slice(1)} ${sqlCount + 1}`,
        blockType,
        sql: DEFAULT_SQL[blockType],
        status: "idle",
        result: null,
        error: null,
        width: DEFAULT_BLOCK_WIDTH,
        height: DEFAULT_BLOCK_HEIGHT,
      },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addSelectBlock: (table) => {
    const count = get().nodes.length;
    const id = nextId();
    const node: SqlNode = {
      id,
      type: "sqlBlock",
      position: { x: 80 + (count % 4) * 400, y: 80 + Math.floor(count / 4) * 280 },
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
      data: {
        title: `Select ${table}`,
        blockType: "query",
        sql: `SELECT * FROM ${quoteIdent(table)} LIMIT 100;`,
        status: "idle",
        result: null,
        error: null,
        width: DEFAULT_BLOCK_WIDTH,
        height: DEFAULT_BLOCK_HEIGHT,
      },
    };
    set({ nodes: [...get().nodes, node], focusedBlockId: id });
    // Auto-run so double-clicking a table immediately shows its rows.
    void get().runBlock(id);
  },

  addGroup: () => {
    const groupCount = get().nodes.filter(isGroupNode).length;
    const color = GROUP_COLORS[groupColorSeq++ % GROUP_COLORS.length];
    const node: GroupNode = {
      id: nextId(),
      type: "group",
      // Offset each new group so they don't stack exactly.
      position: { x: 60 + groupCount * 40, y: 60 + groupCount * 40 },
      width: DEFAULT_GROUP_WIDTH,
      height: DEFAULT_GROUP_HEIGHT,
      data: {
        title: `Group ${groupCount + 1}`,
        color,
        width: DEFAULT_GROUP_WIDTH,
        height: DEFAULT_GROUP_HEIGHT,
      },
    };
    // Groups must precede blocks in the array (parent-before-children).
    set({ nodes: sortGroupsFirst([...get().nodes, node]) });
  },

  renameGroup: (id, title) =>
    set({ nodes: patchNode(get().nodes, id, { title }) }),

  setGroupColor: (id, color) =>
    set({ nodes: patchNode(get().nodes, id, { color }) }),

  deleteGroup: (id) => {
    const all = get().nodes;
    const group = all.find((n) => n.id === id);
    if (!group || !isGroupNode(group)) return;
    const gx = group.position.x;
    const gy = group.position.y;
    // Detach children: convert their relative positions back to absolute.
    const detached = all.map((n) =>
      n.parentId === id
        ? ({
            ...n,
            parentId: undefined,
            position: { x: n.position.x + gx, y: n.position.y + gy },
          } as AnyNode)
        : n,
    );
    set({ nodes: detached.filter((n) => n.id !== id) });
  },

  reparentNode: (id, parentId, position) => {
    const nodes = get().nodes.map((n) =>
      n.id === id
        ? ({
            ...n,
            parentId: parentId ?? undefined,
            position,
          } as AnyNode)
        : n,
    );
    set({ nodes: sortGroupsFirst(nodes) });
  },

  generateInserts: (blockId) => {
    const script = buildInsertScript(get(), blockId);
    if (!script) return;
    spawnScriptBlock(get, set, script.title, script.sql);
  },

  copyInserts: (blockId) => {
    const script = buildInsertScript(get(), blockId);
    if (!script) return;
    void navigator.clipboard?.writeText(script.sql);
  },

  exportInserts: async (blockId) => {
    const script = buildInsertScript(get(), blockId);
    if (!script) return;
    const path = await saveDialog({
      title: "Export INSERTs",
      defaultPath: `${script.title}.sql`,
      filters: [{ name: "SQL", extensions: ["sql"] }],
    });
    if (typeof path !== "string") return;
    try {
      await invoke("write_text_file", { path, contents: script.sql });
    } catch (err) {
      alert(`Could not write the file:\n${String(err)}`);
    }
  },

  importDataFile: async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      title: "Import data",
      filters: [{ name: "Data", extensions: ["json", "sql"] }],
    });
    if (typeof path !== "string") return;

    let contents: string;
    try {
      contents = await invoke<string>("read_text_file", { path });
    } catch (err) {
      alert(`Could not read the file:\n${String(err)}`);
      return;
    }

    const name = path.split(/[\\/]/).pop() ?? "import";
    if (path.toLowerCase().endsWith(".json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch (err) {
        alert(`Invalid JSON:\n${String(err)}`);
        return;
      }
      const { sql, warnings } = jsonToInserts(parsed, get().dbSchema);
      if (!sql.trim()) {
        alert(`Nothing to import:\n${warnings.join("\n")}`);
        return;
      }
      spawnScriptBlock(get, set, name, warningsHeader(warnings) + sql);
    } else {
      // .sql — load it as-is so the user can review and run it.
      spawnScriptBlock(get, set, name, contents);
    }
  },

  toggleCollapse: (id) => {
    const nodes = get().nodes.map((n) => {
      if (n.id !== id || n.type !== "sqlBlock") return n;
      const collapsed = n.data.collapsed === true;
      if (collapsed) {
        // Expanding: restore the height the block had before collapsing.
        const prev = n.data.prevHeight as number | undefined;
        return {
          ...n,
          ...(prev ? { height: prev } : {}),
          data: { ...n.data, collapsed: false, height: prev, prevHeight: undefined },
        } as AnyNode;
      }
      // Collapsing: drop the height so the node shrinks to its header.
      return {
        ...n,
        height: undefined,
        data: {
          ...n.data,
          collapsed: true,
          prevHeight: n.data.height,
          height: undefined,
        },
      } as AnyNode;
    });
    set({ nodes });
  },

  saveBlockAsSnippet: (blockId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const node = get().nodes.find((n) => n.id === blockId);
    if (!node || !isSqlNode(node)) return;
    const snippet: Snippet = {
      id: nextId(),
      name: trimmed,
      sql: node.data.sql,
      blockType: node.data.blockType,
    };
    // Same name overwrites — favorites are keyed by their reference name.
    const rest = get().snippets.filter((s) => s.name !== trimmed);
    set({ snippets: [...rest, snippet] });
  },

  deleteSnippet: (id) =>
    set({ snippets: get().snippets.filter((s) => s.id !== id) }),

  insertSnippetRef: (id) => {
    const snippet = get().snippets.find((s) => s.id === id);
    const focused = get().focusedBlockId;
    if (!snippet || !focused) return;
    insertIntoEditor(focused, `{{${snippet.name}}}`);
  },

  addBlockFromSnippet: (id) => {
    const snippet = get().snippets.find((s) => s.id === id);
    if (!snippet) return;
    const count = get().nodes.length;
    const newId = nextId();
    const node: SqlNode = {
      id: newId,
      type: "sqlBlock",
      position: { x: 80 + (count % 4) * 400, y: 80 + Math.floor(count / 4) * 280 },
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
      data: {
        title: snippet.name,
        blockType: snippet.blockType,
        sql: snippet.sql,
        status: "idle",
        result: null,
        error: null,
        width: DEFAULT_BLOCK_WIDTH,
        height: DEFAULT_BLOCK_HEIGHT,
      },
    };
    set({ nodes: [...get().nodes, node], focusedBlockId: newId });
  },

  updateSql: (id, sql) =>
    set({ nodes: patchNode(get().nodes, id, { sql }) }),

  updateTitle: (id, title) =>
    set({ nodes: patchNode(get().nodes, id, { title }) }),

  setResultView: (id, view) =>
    set({ nodes: patchNode(get().nodes, id, { resultView: view }) }),

  setChartConfig: (id, config) =>
    set({ nodes: patchNode(get().nodes, id, { chartConfig: config }) }),

  setEmitToBlock: (id, enabled) => {
    const nodes = get().nodes;
    const src = nodes.find((n) => n.id === id);
    if (!src || !isSqlNode(src)) return;
    set({
      nodes: patchNode(nodes, id, { emitToBlock: enabled }),
    });
  },

  resizeBlock: (id, width, height) => {
    // Persist dims in data (for save/load) AND on the RF node (for RF to apply).
    const nodes = get().nodes.map((n) =>
      n.id === id
        ? ({
            ...n,
            width,
            height,
            data: { ...n.data, width, height },
          } as AnyNode)
        : n,
    );
    set({ nodes });
  },

  duplicateBlock: (id) => {
    const src = get().nodes.find((n) => n.id === id);
    if (!src || !isSqlNode(src)) return;
    const copy: SqlNode = {
      id: nextId(),
      type: "sqlBlock",
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      // Carry the node-level dimensions too — without them React Flow would
      // re-measure the copy against its content and blow it up.
      width: src.width ?? src.data.width ?? DEFAULT_BLOCK_WIDTH,
      ...(src.data.collapsed
        ? {}
        : { height: src.height ?? src.data.height ?? DEFAULT_BLOCK_HEIGHT }),
      data: {
        ...src.data,
        title: `${src.data.title} (copy)`,
        status: "idle",
        result: null,
        error: null,
        // Don't share the linked result block; the copy starts unlinked.
        linkedResultId: null,
      },
    };
    set({ nodes: [...get().nodes, copy] });
  },

  deleteBlock: (id) => {
    const all = get().nodes;
    const target = all.find((n) => n.id === id);
    // If deleting a source block, cascade-delete its linked result block.
    // If deleting a result block, unlink it from its source.
    const idsToRemove = new Set<string>([id]);
    let nodes = all;
    if (target && isSqlNode(target) && target.data.linkedResultId) {
      idsToRemove.add(target.data.linkedResultId);
    } else if (target && isResultNode(target)) {
      const src = all.find((n) => n.id === target.data.sourceId);
      if (src && isSqlNode(src)) {
        nodes = patchNode(nodes, src.id, { linkedResultId: null });
      }
    }
    nodes = nodes.filter((n) => !idsToRemove.has(n.id));
    const edges = get().edges.filter(
      (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
    );
    set({
      nodes,
      edges,
      focusedBlockId: get().focusedBlockId === id ? null : get().focusedBlockId,
    });
  },

  setFocusedBlock: (id) => set({ focusedBlockId: id }),

  runBlock: async (id) => {
    const { dbPath, nodes } = get();
    const node = nodes.find((n) => n.id === id);
    if (!node || !isSqlNode(node)) return;

    if (!dbPath) {
      set({
        nodes: patchNode(nodes, id, {
          status: "error",
          error: "No database connected for this project.",
        }),
      });
      return;
    }

    // Route: if emitToBlock, results flow into a linked result block; else
    // embedded in the source block's footer.
    const routed = node.data.emitToBlock === true;

    set({ nodes: patchNode(get().nodes, id, { status: "running", error: null }) });
    // Ensure the linked block exists (spawn it before execution so its
    // "running" state is visible immediately).
    if (routed) ensureLinkedResult(get, set, node);

    try {
      // Expand `{{favorite}}` references into inline subqueries before running.
      const sql = expandSnippets(node.data.sql, get().snippets);
      const result = await invoke<QueryResult>("execute_sql", {
        dbPath,
        sql,
        maxRows: MAX_FETCH_ROWS,
      });
      writeRunResult(get, set, id, { status: "success", result, error: null });
      // DDL may have changed the schema — refresh autocompletion data.
      if (/\b(create|alter|drop)\b/i.test(node.data.sql)) void get().refreshSchema();
    } catch (err) {
      writeRunResult(get, set, id, {
        status: "error",
        result: null,
        error: String(err),
      });
    }
  },

  runAll: async () => {
    // Sequential so results land predictably and we don't hammer the pool.
    for (const node of get().nodes) {
      if (isSqlNode(node)) await get().runBlock(node.id);
    }
  },

  saveNotebook: async () => {
    const { projectPath } = get();
    if (!projectPath) return; // projects always have a path once created
    await invoke("save_notebook", {
      path: projectPath,
      contents: JSON.stringify(serializeNotebook(get()), null, 2),
    });
    touchRecent(get, set, {
      name: get().projectName ?? "untitled",
      projectPath,
      dbType: get().dbType,
      dbPath: get().dbPath,
    });
  },
}));

/** Ensure the given SQL block has a companion resultBlock + connecting edge.
 *  Called before `execute_sql` so the linked block shows "running" state
 *  immediately. Idempotent — reuses an existing linked block. */
function ensureLinkedResult(
  get: () => GraftState,
  set: (partial: Partial<GraftState>) => void,
  src: SqlNode,
) {
  const state = get();
  const existing = src.data.linkedResultId
    ? state.nodes.find((n) => n.id === src.data.linkedResultId)
    : undefined;

  if (existing) {
    // Mark it as running for user feedback.
    set({
      nodes: patchNode(state.nodes, existing.id, {
        status: "running",
        error: null,
      }),
    });
    return;
  }

  // Position the new block to the right of the source.
  const srcWidth = (src.width ?? src.data.width ?? DEFAULT_BLOCK_WIDTH) as number;
  const newId = nextId();
  const resultNode: ResultNode = {
    id: newId,
    type: "resultBlock",
    position: { x: src.position.x + srcWidth + 60, y: src.position.y },
    width: DEFAULT_RESULT_WIDTH,
    height: DEFAULT_RESULT_HEIGHT,
    data: {
      sourceId: src.id,
      sourceTitle: src.data.title,
      status: "running",
      result: null,
      error: null,
      width: DEFAULT_RESULT_WIDTH,
      height: DEFAULT_RESULT_HEIGHT,
    },
  };
  const edge: Edge = {
    id: `edge-${src.id}-${newId}`,
    source: src.id,
    target: newId,
  };

  set({
    nodes: [
      ...patchNode(state.nodes, src.id, { linkedResultId: newId }),
      resultNode,
    ],
    edges: [...state.edges, edge],
  });
}

/** Write execution result to the source block OR its linked result block. */
function writeRunResult(
  get: () => GraftState,
  set: (partial: Partial<GraftState>) => void,
  sourceId: string,
  patch: {
    status: "success" | "error";
    result?: QueryResult | null;
    error?: string | null;
  },
) {
  const state = get();
  const src = state.nodes.find((n) => n.id === sourceId);
  if (!src || !isSqlNode(src)) return;

  const routed = src.data.emitToBlock === true;
  const targetId =
    routed && src.data.linkedResultId ? src.data.linkedResultId : sourceId;

  let nodes = patchNode(state.nodes, targetId, patch);
  // Also mirror source status so its header dot stays in sync even when the
  // payload was routed elsewhere. Don't overwrite the routed target's data.
  if (targetId !== sourceId) {
    nodes = patchNode(nodes, sourceId, { status: patch.status, error: null });
    // Keep the linked block's title in sync with the source title.
    const s = nodes.find((n) => n.id === sourceId);
    if (s && isSqlNode(s)) {
      nodes = patchNode(nodes, targetId, { sourceTitle: s.data.title });
    }
  }
  set({ nodes });
}

/** Insert/update a recent-project entry, move it to the top, and persist. */
function touchRecent(
  get: () => GraftState,
  set: (partial: Partial<GraftState>) => void,
  entry: Omit<RecentProject, "modifiedAt">,
) {
  const without = get().recentProjects.filter(
    (p) => p.projectPath !== entry.projectPath,
  );
  const next = [{ ...entry, modifiedAt: new Date().toISOString() }, ...without].slice(
    0,
    RECENTS_MAX,
  );
  persistRecents(next);
  set({ recentProjects: next });
}
