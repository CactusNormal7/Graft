import { describe, expect, it } from "vitest";
import { mergeExternalBlocks, type MergeNode, type MergePage } from "./externalMerge";
import type { NotebookFile, NotebookNode } from "../types";

const block = (id: string, sql: string, x = 0): NotebookNode => ({
  id,
  type: "sqlBlock",
  position: { x, y: 0 },
  data: { title: id, blockType: "query", sql, status: "idle", result: null, error: null },
});

const file = (nodes: NotebookNode[], name = "p"): NotebookFile => ({
  version: 6,
  name,
  dbType: "sqlite",
  dbPath: "/a.db",
  pages: [{ id: "p1", name: "Main", nodes, edges: [] }],
});

const mine = (nodes: NotebookNode[]): MergePage<MergeNode>[] => [
  { id: "p1", nodes: nodes.map((n) => ({ ...n, data: { ...(n.data as object) } })) },
];

const toNode = (node: NotebookNode): MergeNode => ({ ...node, data: { ...(node.data as object) } });
const sqlOf = (pages: MergePage<MergeNode>[] | null) =>
  pages?.[0].nodes.map((n) => [n.id, (n.data as { sql: string }).sql]);

describe("mergeExternalBlocks", () => {
  const base = file([block("a", "SELECT 1"), block("b", "SELECT 2")]);

  it("adds their new block and keeps my unsaved edit", () => {
    const theirs = file([block("a", "SELECT 1"), block("b", "SELECT 2"), block("c", "SELECT 3")]);
    const merged = mergeExternalBlocks(base, theirs, mine([block("a", "SELECT 10"), block("b", "SELECT 2")]), toNode);
    expect(sqlOf(merged)).toEqual([["a", "SELECT 10"], ["b", "SELECT 2"], ["c", "SELECT 3"]]);
  });

  it("applies their edit to a block I did not touch, keeping its other data", () => {
    const theirs = file([block("a", "SELECT 1"), block("b", "SELECT 20", 50)]);
    const mineWithView = mine(base.pages![0].nodes);
    (mineWithView[0].nodes[1].data as Record<string, unknown>).resultView = "chart";
    const merged = mergeExternalBlocks(base, theirs, mineWithView, toNode)!;
    expect(sqlOf(merged)).toEqual([["a", "SELECT 1"], ["b", "SELECT 20"]]);
    expect(merged[0].nodes[1].position.x).toBe(50);
    expect((merged[0].nodes[1].data as Record<string, unknown>).resultView).toBe("chart");
  });

  it("refuses when both sides changed the same block differently", () => {
    const theirs = file([block("a", "SELECT 'theirs'"), block("b", "SELECT 2")]);
    expect(mergeExternalBlocks(base, theirs, mine([block("a", "SELECT 'mine'"), block("b", "SELECT 2")]), toNode)).toBeNull();
  });

  it("refuses changes beyond blocks, and blocks they deleted", () => {
    const renamed = file([block("a", "SELECT 1"), block("b", "SELECT 2")], "renamed");
    expect(mergeExternalBlocks(base, renamed, mine(base.pages![0].nodes), toNode)).toBeNull();
    const deleted = file([block("a", "SELECT 1")]);
    expect(mergeExternalBlocks(base, deleted, mine(base.pages![0].nodes), toNode)).toBeNull();
  });

  it("refuses their edit to a block I deleted", () => {
    const theirs = file([block("a", "SELECT 1"), block("b", "SELECT 99")]);
    expect(mergeExternalBlocks(base, theirs, mine([block("a", "SELECT 1")]), toNode)).toBeNull();
  });
});
