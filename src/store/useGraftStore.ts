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
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  BlockType,
  DbType,
  NotebookFile,
  QueryResult,
  RecentProject,
  ResultBlockData,
  ResultView,
  SqlBlockData,
} from "../types";

/** A canvas node whose data is a SQL block. */
export type SqlNode = Node<SqlBlockData, "sqlBlock">;

/** A canvas node whose data is the linked result of a SQL block. */
export type ResultNode = Node<ResultBlockData, "resultBlock">;

/** Anything that can live on the canvas. */
export type AnyNode = SqlNode | ResultNode;

const isSqlNode = (n: AnyNode): n is SqlNode => n.type === "sqlBlock";
const isResultNode = (n: AnyNode): n is ResultNode => n.type === "resultBlock";

/** Default new-block dimensions (persisted only after user resize). */
const DEFAULT_BLOCK_WIDTH = 360;

let nodeSeq = 0;
const nextId = () => `block-${Date.now()}-${nodeSeq++}`;

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
  nodes: AnyNode[];
  edges: Edge[];

  // Current project
  projectName: string | null;
  /** Absolute path to the current `.graft` file, or null if unsaved. */
  projectPath: string | null;
  dbType: DbType;
  /** Path to the connected database file (SQLite), or null if none. */
  dbPath: string | null;

  /** Introspected schema: table/view name → column names (for autocompletion). */
  schema: Record<string, string[]>;

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

  refreshSchema: () => Promise<void>;
  addBlock: (blockType: BlockType) => void;
  updateSql: (id: string, sql: string) => void;
  updateTitle: (id: string, title: string) => void;
  setResultView: (id: string, view: ResultView) => void;
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

/** Build the on-disk notebook shape from the current state. */
function serializeNotebook(state: GraftState): NotebookFile {
  return {
    version: 2,
    name: state.projectName ?? "untitled",
    dbType: state.dbType,
    dbPath: state.dbPath,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      // Reset transient execution state so saved files stay diff-friendly.
      data: { ...n.data, status: "idle", result: null, error: null },
    })),
    edges: state.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export const useGraftStore = create<GraftState>((set, get) => ({
  view: "home",
  nodes: [],
  edges: [],
  projectName: null,
  projectPath: null,
  dbType: "sqlite",
  dbPath: null,
  schema: {},
  focusedBlockId: null,
  recentProjects: loadRecents(),

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) =>
    set({ edges: addEdge(connection, get().edges) }),

  goHome: () => set({ view: "home" }),

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

    set({
      view: "canvas",
      nodes: [],
      edges: [],
      projectName: name,
      projectPath: paths.projectPath,
      dbType,
      dbPath,
    });

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
    void get().refreshSchema();
  },

  openProjectByPath: async (projectPath) => {
    try {
      const contents = await invoke<string>("load_notebook", { path: projectPath });
      const file = JSON.parse(contents) as NotebookFile;
      set({
        view: "canvas",
        projectName: file.name ?? "untitled",
        projectPath,
        dbType: file.dbType ?? "sqlite",
        dbPath: file.dbPath,
        nodes: file.nodes.map((n) => {
          const kind = n.type ?? "sqlBlock";
          const d = n.data as SqlBlockData & ResultBlockData;
          // Restore persisted dimensions so React Flow reapplies them.
          const dims = {
            ...(d.width ? { width: d.width } : {}),
            ...(d.height ? { height: d.height } : {}),
          };
          return {
            id: n.id,
            type: kind,
            position: n.position,
            data: n.data,
            ...dims,
          } as AnyNode;
        }),
        edges: file.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
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
      set({ schema: {} });
      return;
    }
    try {
      const schema = await invoke<Record<string, string[]>>("introspect_schema", { dbPath });
      set({ schema });
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
      data: {
        title: `${blockType[0].toUpperCase()}${blockType.slice(1)} ${sqlCount + 1}`,
        blockType,
        sql: DEFAULT_SQL[blockType],
        status: "idle",
        result: null,
        error: null,
      },
    };
    set({ nodes: [...get().nodes, node] });
  },

  updateSql: (id, sql) =>
    set({ nodes: patchNode(get().nodes, id, { sql }) }),

  updateTitle: (id, title) =>
    set({ nodes: patchNode(get().nodes, id, { title }) }),

  setResultView: (id, view) =>
    set({ nodes: patchNode(get().nodes, id, { resultView: view }) }),

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
      const result = await invoke<QueryResult>("execute_sql", {
        dbPath,
        sql: node.data.sql,
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
    data: {
      sourceId: src.id,
      sourceTitle: src.data.title,
      status: "running",
      result: null,
      error: null,
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
