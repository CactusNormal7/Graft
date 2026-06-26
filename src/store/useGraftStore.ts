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
import type { BlockType, NotebookFile, QueryResult, SqlBlockData } from "../types";

/** A canvas node whose data is a SQL block. */
export type SqlNode = Node<SqlBlockData, "sqlBlock">;

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

interface GraftState {
  nodes: SqlNode[];
  edges: Edge[];
  /** Path to the connected SQLite database, or null if none. */
  dbPath: string | null;

  onNodesChange: (changes: NodeChange<SqlNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addBlock: (blockType: BlockType) => void;
  updateSql: (id: string, sql: string) => void;
  runBlock: (id: string) => Promise<void>;

  connectDatabase: () => Promise<void>;
  saveNotebook: () => Promise<void>;
  loadNotebook: () => Promise<void>;
}

/** Immutably patch the data of a single node. */
function patchNode(
  nodes: SqlNode[],
  id: string,
  patch: Partial<SqlBlockData>,
): SqlNode[] {
  return nodes.map((n) =>
    n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
  );
}

export const useGraftStore = create<GraftState>((set, get) => ({
  nodes: [],
  edges: [],
  dbPath: null,

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) =>
    set({ edges: addEdge(connection, get().edges) }),

  addBlock: (blockType) => {
    const count = get().nodes.length;
    const node: SqlNode = {
      id: nextId(),
      type: "sqlBlock",
      // Stagger new blocks so they don't stack exactly on top of each other.
      position: { x: 80 + (count % 4) * 360, y: 80 + Math.floor(count / 4) * 280 },
      data: {
        title: `${blockType[0].toUpperCase()}${blockType.slice(1)} ${count + 1}`,
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

  runBlock: async (id) => {
    const { dbPath, nodes } = get();
    const node = nodes.find((n) => n.id === id);
    if (!node) return;

    if (!dbPath) {
      set({
        nodes: patchNode(nodes, id, {
          status: "error",
          error: "No database connected. Click “Connect SQLite…” first.",
        }),
      });
      return;
    }

    set({ nodes: patchNode(get().nodes, id, { status: "running", error: null }) });
    try {
      const result = await invoke<QueryResult>("execute_sql", {
        dbPath,
        sql: node.data.sql,
      });
      set({
        nodes: patchNode(get().nodes, id, {
          status: "success",
          result,
          error: null,
        }),
      });
    } catch (err) {
      set({
        nodes: patchNode(get().nodes, id, {
          status: "error",
          result: null,
          error: String(err),
        }),
      });
    }
  },

  connectDatabase: async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "Connect to SQLite database",
      filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    if (typeof selected === "string") set({ dbPath: selected });
  },

  saveNotebook: async () => {
    const path = await saveDialog({
      title: "Save notebook",
      defaultPath: "notebook.graft",
      filters: [{ name: "Graft notebook", extensions: ["graft"] }],
    });
    if (!path) return;

    const { nodes, edges, dbPath } = get();
    const file: NotebookFile = {
      version: 1,
      dbPath,
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
        // Reset transient execution state so saved files stay diff-friendly.
        data: { ...n.data, status: "idle", result: null, error: null },
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
    await invoke("save_notebook", { path, contents: JSON.stringify(file, null, 2) });
  },

  loadNotebook: async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      title: "Open notebook",
      filters: [{ name: "Graft notebook", extensions: ["graft"] }],
    });
    if (typeof path !== "string") return;

    const contents = await invoke<string>("load_notebook", { path });
    const file = JSON.parse(contents) as NotebookFile;
    set({
      dbPath: file.dbPath,
      nodes: file.nodes.map((n) => ({
        id: n.id,
        type: "sqlBlock",
        position: n.position,
        data: n.data,
      })),
      edges: file.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  },
}));
