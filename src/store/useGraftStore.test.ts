import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store talks to the backend through Tauri IPC and native dialogs: replace
// both with in-memory fakes.
const files = new Map<string, string>();
const stamps = new Map<string, number>();
const passwords = new Map<string, string>();
const savedConnections: unknown[] = [];
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "load_notebook":
      return files.get(args!.path as string);
    case "save_notebook":
      files.set(args!.path as string, args!.contents as string);
      stamps.set(args!.path as string, (stamps.get(args!.path as string) ?? 0) + 1);
      return null;
    case "project_file_stamp":
      return stamps.get(args!.path as string) ?? 0;
    case "introspect_schema":
      return { tables: [], triggers: [], routines: [] };
    case "register_project":
      return null;
    case "save_connection":
      savedConnections.push({ name: args!.name, connection: args!.connection });
      return [...savedConnections];
    case "list_saved_connections":
      return [...savedConnections];
    case "set_connection_password":
      passwords.set(args!.connectionId as string, args!.password as string);
      return null;
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
const { useDialogStore } = await import("../dialogs/appDialogs");
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

describe("formatting", () => {
  beforeEach(async () => {
    files.clear();
    writeProject("/p/f.graft", "f");
    await store.getState().openProjectByPath("/p/f.graft");
  });

  it("formats a block and leaves unparseable SQL untouched", () => {
    store.getState().addBlock("query");
    const id = store.getState().nodes[0].id;
    store.getState().updateSql(id, "select a from {{fav}} where x=1");
    store.getState().formatBlock(id);
    expect(store.getState().nodes[0].data.sql).toBe("SELECT\n  a\nFROM\n  {{fav}}\nWHERE\n  x = 1");

    store.getState().updateSql(id, "select (( from");
    store.getState().formatBlock(id);
    expect(store.getState().nodes[0].data.sql).toBe("select (( from");
    const { queue } = useDialogStore.getState();
    expect(queue[queue.length - 1]).toMatchObject({
      kind: "message",
      tone: "error",
      title: "Could not format the SQL",
    });
  });
});

describe("running blocks", () => {
  beforeEach(async () => {
    files.clear();
    writeProject("/p/r.graft", "r");
    await store.getState().openProjectByPath("/p/r.graft");
  });

  it("ignores a second run while the block is already running", async () => {
    store.getState().addBlock("query");
    const id = store.getState().nodes[0].id;
    invoke.mockClear();
    const first = store.getState().runBlock(id);
    const second = store.getState().runBlock(id);
    await Promise.all([first, second]);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "execute_sql")).toHaveLength(1);
  });
});

describe("connections", () => {
  // Earlier tests may leave unsaved edits: accept discarding them here.
  beforeEach(() => confirmDialog.mockResolvedValue(true));
  afterEach(() => confirmDialog.mockResolvedValue(false));

  it("opens a pre-v6 SQLite project and saves it as a v6 connection", async () => {
    files.clear();
    writeProject("/p/legacy.graft", "legacy");
    await store.getState().openProjectByPath("/p/legacy.graft");
    expect(store.getState().connection).toMatchObject({ engine: "sqlite", path: "/tmp/x.db" });

    await store.getState().saveNotebook();
    const saved = JSON.parse(files.get("/p/legacy.graft")!);
    expect(saved.version).toBe(6);
    expect(saved.connection).toMatchObject({ engine: "sqlite", path: "/tmp/x.db" });
    expect(saved.dbPath).toBe("/tmp/x.db");
  });

  it("keeps server passwords out of the project file", async () => {
    files.clear();
    writeProject("/p/server.graft", "server");
    await store.getState().openProjectByPath("/p/server.graft");
    const connection = {
      id: "conn-pg",
      engine: "postgres" as const,
      host: "db.internal",
      user: "ada",
      database: "shop",
    };
    await store.getState().updateConnection(connection, "s3cret");
    expect(passwords.get("conn-pg")).toBe("s3cret");
    expect(unsaved()).toBe(true);

    await store.getState().saveNotebook();
    const raw = files.get("/p/server.graft")!;
    expect(raw).not.toContain("s3cret");
    const saved = JSON.parse(raw);
    expect(saved.connection).toEqual(connection);
    expect(saved.dbType).toBe("postgres");
    expect(saved.dbPath).toBeNull();

    const introspections = invoke.mock.calls.filter(([cmd]) => cmd === "introspect_schema");
    expect(introspections[introspections.length - 1][1]).toEqual({ connection });
  });
});

describe("table nodes", () => {
  beforeEach(() => confirmDialog.mockResolvedValue(true));
  afterEach(() => confirmDialog.mockResolvedValue(false));

  it("adds the referenced tables once and saves them without execution state", async () => {
    files.clear();
    writeProject("/p/t.graft", "t");
    await store.getState().openProjectByPath("/p/t.graft");
    const table = (name: string) => ({ name, kind: "table", columns: [], foreign_keys: [] });
    store.setState({ dbSchema: [table("users"), table("orders")] });

    store.getState().addBlock("query");
    const id = store.getState().nodes[0].id;
    store.getState().updateSql(id, "SELECT * FROM users JOIN orders ON orders.user_id = users.id");

    expect(store.getState().addReferencedTables()).toBe(2);
    expect(store.getState().addReferencedTables()).toBe(0);
    store.getState().addTableNode("users");
    const tables = store.getState().nodes.filter((n) => n.type === "tableNode");
    expect(tables.map((n) => n.data.table)).toEqual(["users", "orders"]);
    // Stacked left of the block.
    expect(tables[0].position.x).toBeLessThan(store.getState().nodes[0].position.x);

    await store.getState().saveNotebook();
    const saved = JSON.parse(files.get("/p/t.graft")!);
    const savedTable = saved.pages[0].nodes.find((n: { type: string }) => n.type === "tableNode");
    expect(savedTable.data).toEqual({ table: "users" });
  });
});

describe("changes made outside the app", () => {
  beforeEach(() => confirmDialog.mockResolvedValue(true));
  afterEach(() => confirmDialog.mockResolvedValue(false));

  /** Simulate another program (graft-mcp) rewriting the project file. */
  function editOnDisk(path: string, edit: (file: Record<string, unknown>) => void) {
    const file = JSON.parse(files.get(path)!);
    edit(file);
    files.set(path, JSON.stringify(file));
    stamps.set(path, (stamps.get(path) ?? 0) + 1);
  }

  async function answerDialog(confirmed: boolean) {
    await vi.waitFor(() => expect(useDialogStore.getState().queue.length).toBe(1));
    const request = useDialogStore.getState().queue[0];
    if (request.kind !== "confirm") throw new Error("expected a confirm dialog");
    request.resolve(confirmed);
  }

  beforeEach(async () => {
    files.clear();
    useDialogStore.setState({ queue: [] });
    writeProject("/p/w.graft", "w");
    await store.getState().openProjectByPath("/p/w.graft");
    await store.getState().checkProjectFile(); // records the current stamp
  });

  it("merges a block added by Claude without asking, keeping unsaved edits", async () => {
    await store.getState().saveNotebook(); // disk now has the app's page
    await store.getState().checkProjectFile();
    store.getState().addBlock("query"); // unsaved local edit
    const mine = store.getState().nodes[0].id;
    editOnDisk("/p/w.graft", (file) => {
      const pages = file.pages as Array<{ nodes: unknown[] }>;
      pages[0].nodes.push({
        id: "block-mcp-1",
        type: "sqlBlock",
        position: { x: 80, y: 500 },
        data: { title: "From Claude", blockType: "query", sql: "SELECT 42" },
      });
    });
    await store.getState().checkProjectFile();
    expect(useDialogStore.getState().queue).toHaveLength(0);
    expect(store.getState().nodes.map((n) => n.id)).toEqual([mine, "block-mcp-1"]);
    expect(unsaved()).toBe(true);

    await store.getState().saveNotebook(); // no overwrite question: merged
    expect(useDialogStore.getState().queue).toHaveLength(0);
    const saved = JSON.parse(files.get("/p/w.graft")!);
    expect(saved.pages[0].nodes.map((n: { id: string }) => n.id)).toEqual([mine, "block-mcp-1"]);
  });

  it("offers to reload, and reloads when accepted", async () => {
    editOnDisk("/p/w.graft", (file) => (file.name = "renamed by Claude"));
    const check = store.getState().checkProjectFile();
    await answerDialog(true);
    await check;
    expect(store.getState().projectName).toBe("renamed by Claude");
    expect(unsaved()).toBe(false);

    await store.getState().checkProjectFile();
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });

  it("asks before a save would overwrite the external change", async () => {
    editOnDisk("/p/w.graft", (file) => (file.name = "external"));
    const check = store.getState().checkProjectFile();
    await answerDialog(false); // keep my version for now
    await check;
    store.getState().addBlock("query");

    const refused = store.getState().saveNotebook();
    await answerDialog(false);
    await refused;
    expect(JSON.parse(files.get("/p/w.graft")!).name).toBe("external");

    const accepted = store.getState().saveNotebook();
    await answerDialog(true);
    await accepted;
    expect(JSON.parse(files.get("/p/w.graft")!).name).toBe("w");
  });

  it("saves without asking when nothing changed outside", async () => {
    store.getState().addBlock("query");
    await store.getState().saveNotebook();
    expect(useDialogStore.getState().queue).toHaveLength(0);
    await store.getState().checkProjectFile();
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });
});

describe("saved connections", () => {
  it("adds a named connection to the library and lets a new project start from it", async () => {
    const connection = { id: "conn-shared", engine: "postgres" as const, host: "db", user: "ada" };
    await store.getState().saveNamedConnection("Prod", connection);
    expect(store.getState().savedConnections).toEqual([{ name: "Prod", connection }]);

    store.getState().setNewProjectModalOpen(true, connection);
    expect(store.getState().newProjectConnection).toEqual(connection);
    store.getState().setNewProjectModalOpen(false);
    expect(store.getState().newProjectConnection).toBeNull();
  });
});
