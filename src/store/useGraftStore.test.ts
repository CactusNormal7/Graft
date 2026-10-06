import { beforeEach, describe, expect, it, vi } from "vitest";

// The store talks to the backend through Tauri IPC and native dialogs: replace
// both with in-memory fakes.
const files = new Map<string, string>();
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "load_notebook":
      return files.get(args!.path as string);
    case "save_notebook":
      files.set(args!.path as string, args!.contents as string);
      return null;
    case "introspect_schema":
      return [];
    case "execute_sql":
      return { columns: ["x"], rows: [[1]], rows_affected: 0, elapsed_ms: 1 };
  }
  throw new Error(`unexpected command ${cmd}`);
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const confirmDialog = vi.fn(async () => false);
vi.mock("../native", () => ({
  confirmDialog,
  pickExportFile: vi.fn(),
  pickImportFile: vi.fn(),
  pickProjectFile: vi.fn(),
  setUnsavedChanges: vi.fn(async () => undefined),
  watchProject: vi.fn(async () => undefined),
}));

const { useGraftStore, hasUnsavedChanges } = await import("./useGraftStore");
const store = useGraftStore;
const unsaved = () => hasUnsavedChanges(store.getState());

function writeProject(path: string, name: string) {
  files.set(
    path,
    JSON.stringify({ version: 5, name, dbType: "sqlite", dbPath: "/tmp/x.db", pages: [] }),
  );
}

describe("unsaved changes", () => {
  beforeEach(async () => {
    files.clear();
    confirmDialog.mockClear();
    writeProject("/p/a.graft", "a");
    writeProject("/p/b.graft", "b");
    await store.getState().openProjectByPath("/p/a.graft");
  });

  it("starts clean after opening a project", () => {
    expect(store.getState().projectName).toBe("a");
    expect(unsaved()).toBe(false);
  });

  it("counts edits but not run results", async () => {
    store.getState().addBlock("query");
    expect(unsaved()).toBe(true);
    await store.getState().saveNotebook();
    expect(unsaved()).toBe(false);

    const id = store.getState().nodes[0].id;
    await store.getState().runBlock(id);
    expect(store.getState().nodes[0].data.status).toBe("success");
    expect(unsaved()).toBe(false);
  });

  it("asks before discarding, and keeps the project when refused", async () => {
    store.getState().addBlock("query");
    confirmDialog.mockResolvedValueOnce(false);
    await store.getState().openProjectByPath("/p/b.graft");
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(store.getState().projectName).toBe("a");
    expect(store.getState().nodes).toHaveLength(1);

    confirmDialog.mockResolvedValueOnce(true);
    await store.getState().openProjectByPath("/p/b.graft");
    expect(store.getState().projectName).toBe("b");
  });

  it("stays clean after running a block saved without run state", async () => {
    // Older or hand-written files may omit status/result/error.
    files.set(
      "/p/bare.graft",
      JSON.stringify({
        version: 5, name: "bare", dbType: "sqlite", dbPath: "bare.db",
        pages: [{ id: "p", name: "Main", edges: [], nodes: [
          { id: "b1", type: "sqlBlock", position: { x: 0, y: 0 },
            data: { title: "Q", blockType: "query", sql: "SELECT 1", width: 520 } },
        ] }],
      }),
    );
    await store.getState().openProjectByPath("/p/bare.graft");
    invoke.mockClear();
    await store.getState().runBlock("b1");
    expect(unsaved()).toBe(false);
    // A relative dbPath is resolved next to the project file.
    expect(invoke).toHaveBeenCalledWith("execute_sql", expect.objectContaining({ dbPath: "/p/bare.db" }));
  });

  it("doesn't ask when nothing changed", async () => {
    await store.getState().openProjectByPath("/p/b.graft");
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(store.getState().projectName).toBe("b");
  });

  it("updates the debounced dirty flag for the UI", async () => {
    vi.useFakeTimers();
    try {
      store.getState().addBlock("query");
      expect(store.getState().dirty).toBe(false);
      await vi.runAllTimersAsync();
      expect(store.getState().dirty).toBe(true);
      await store.getState().saveNotebook();
      expect(store.getState().dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reload after an outside edit", () => {
  const path = "/p/shop.graft";
  // The project as another writer (graft-mcp) leaves it: one block "b1".
  const onDisk = (sql: string, extra: object[] = []) =>
    files.set(
      path,
      JSON.stringify({
        version: 5,
        name: "shop",
        dbType: "sqlite",
        dbPath: "/tmp/x.db",
        pages: [
          { id: "p1", name: "Main", edges: [], nodes: [
            { id: "b1", type: "sqlBlock", position: { x: 0, y: 0 },
              data: { title: "Q", blockType: "query", sql, status: "idle", result: null, error: null } },
            ...extra,
          ] },
          { id: "p2", name: "Other", nodes: [], edges: [] },
        ],
      }),
    );
  const block = (id: string, sql: string) => ({
    id, type: "sqlBlock", position: { x: 0, y: 0 },
    data: { title: id, blockType: "query", sql, status: "idle", result: null, error: null },
  });

  beforeEach(async () => {
    files.clear();
    confirmDialog.mockClear();
    onDisk("SELECT 1");
    await store.getState().openProjectByPath(path);
  });

  it("reloads silently when there is nothing to lose, keeping page and results", async () => {
    await store.getState().runBlock("b1");
    store.getState().switchPage("p2");
    store.getState().switchPage("p1");
    onDisk("SELECT 1", [block("b2", "SELECT 2")]);

    await store.getState().reloadFromDisk();
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(store.getState().nodes.map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(store.getState().activePageId).toBe("p1");
    expect(store.getState().nodes[0].data.status).toBe("success");
    expect(unsaved()).toBe(false);
  });

  it("drops the result of a block whose SQL changed outside", async () => {
    await store.getState().runBlock("b1");
    onDisk("SELECT 42");
    await store.getState().reloadFromDisk();
    expect(store.getState().nodes[0].data.status).toBe("idle");
  });

  it("asks before discarding unsaved edits, and keeps them when refused", async () => {
    store.getState().addBlock("query");
    onDisk("SELECT 1", [block("b2", "SELECT 2")]);

    confirmDialog.mockResolvedValueOnce(false);
    await store.getState().reloadFromDisk();
    expect(confirmDialog).toHaveBeenCalledOnce();
    expect(store.getState().nodes).toHaveLength(2);
    expect(store.getState().nodes.some((n) => n.id === "b2")).toBe(false);
    expect(unsaved()).toBe(true);

    confirmDialog.mockResolvedValueOnce(true);
    await store.getState().reloadFromDisk();
    expect(store.getState().nodes.map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(unsaved()).toBe(false);
  });
});
