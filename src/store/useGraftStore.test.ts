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

describe("execution errors", () => {
  beforeEach(async () => {
    files.clear();
    writeProject("/p/e.graft", "e");
    await store.getState().openProjectByPath("/p/e.graft");
  });

  it("locates the error for the editor and clears it on edit", async () => {
    store.getState().addBlock("query");
    const id = store.getState().nodes[0].id;
    store.getState().updateSql(id, "SELECT * FORM t");
    invoke.mockRejectedValueOnce({ message: 'near "FORM": syntax error', position: null });

    await store.getState().runBlock(id);
    const failed = store.getState().nodes[0].data;
    expect(failed.status).toBe("error");
    expect(failed.error).toBe('near "FORM": syntax error');
    expect(failed.editorError).toMatchObject({ from: 9, to: 13 });

    store.getState().updateSql(id, "SELECT * FROM t");
    expect(store.getState().nodes[0].data.editorError).toBeNull();
  });
});
