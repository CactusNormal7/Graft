/**
 * Three-way merge of SQL blocks changed outside the app (Claude through
 * graft-mcp) into the open project, so they appear live without discarding
 * the user's unsaved edits. Pure: unit-tested without the store.
 *
 *  - base   : the file as the app last read or wrote it;
 *  - theirs : the file on disk now;
 *  - mine   : the app's current pages (maybe with unsaved edits).
 *
 * Only what graft-mcp can do is merged: new SQL blocks, and changes to a
 * block's SQL / title / type / position. Anything else that differs (pages,
 * groups, favorites, connection…), a block both sides changed differently,
 * or a block mine deleted but theirs changed → null, and the caller falls
 * back to asking the user.
 */
import type { NotebookFile, NotebookNode, SqlBlockData } from "../types";

/** The slice of a store page this module reads and writes. */
export interface MergePage<N> {
  id: string;
  nodes: N[];
}

/** A canvas node as far as merging is concerned. */
export interface MergeNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: unknown;
}

interface BlockFields {
  sql: string;
  title: string;
  blockType: string;
  x: number;
  y: number;
}

const isSqlBlock = (node: { type?: string }) => (node.type ?? "sqlBlock") === "sqlBlock";

function fieldsOf(node: MergeNode | NotebookNode): BlockFields {
  const data = node.data as Partial<SqlBlockData>;
  return {
    sql: data.sql ?? "",
    title: data.title ?? "",
    blockType: data.blockType ?? "query",
    x: node.position.x,
    y: node.position.y,
  };
}

function sameFields(a: BlockFields, b: BlockFields): boolean {
  return (
    a.sql === b.sql &&
    a.title === b.title &&
    a.blockType === b.blockType &&
    a.x === b.x &&
    a.y === b.y
  );
}

/** Everything but the SQL blocks, to check nothing else changed. */
function withoutBlocks(file: NotebookFile): string {
  return JSON.stringify({
    ...file,
    pages: file.pages?.map((page) => ({ ...page, nodes: page.nodes.filter((n) => !isSqlBlock(n)) })),
  });
}

function blocksById(file: NotebookFile): Map<string, NotebookNode> {
  const map = new Map<string, NotebookNode>();
  for (const page of file.pages ?? []) {
    for (const node of page.nodes) if (isSqlBlock(node)) map.set(node.id, node);
  }
  return map;
}

/** `mine` with their block changes applied, or null when it can't be done
 *  safely. `toNode` turns a file node into a store node. */
export function mergeExternalBlocks<N extends MergeNode>(
  base: NotebookFile,
  theirs: NotebookFile,
  mine: MergePage<N>[],
  toNode: (node: NotebookNode) => N,
): MergePage<N>[] | null {
  // Single-canvas files (pre-v4) are never written by graft-mcp merges.
  if (!base.pages || !theirs.pages) return null;
  if (withoutBlocks(base) !== withoutBlocks(theirs)) return null;

  const baseBlocks = blocksById(base);
  const theirBlocks = blocksById(theirs);
  for (const id of baseBlocks.keys()) if (!theirBlocks.has(id)) return null; // they deleted

  const merged: MergePage<N>[] = [];
  for (const page of mine) {
    const theirPage = theirs.pages.find((p) => p.id === page.id);
    if (!theirPage) return null;
    let nodes = [...page.nodes];
    for (const their of theirPage.nodes.filter(isSqlBlock)) {
      const baseNode = baseBlocks.get(their.id);
      const index = nodes.findIndex((n) => n.id === their.id);
      const mineNode = index === -1 ? undefined : nodes[index];
      if (!baseNode) {
        if (mineNode) return null; // same id created on both sides
        nodes = [...nodes, toNode(their)];
        continue;
      }
      const theirsChanged = !sameFields(fieldsOf(baseNode), fieldsOf(their));
      if (!theirsChanged) continue;
      if (!mineNode) return null; // they edited a block I deleted
      const mineChanged = !sameFields(fieldsOf(baseNode), fieldsOf(mineNode));
      if (mineChanged && !sameFields(fieldsOf(mineNode), fieldsOf(their))) return null;
      const fields = fieldsOf(their);
      nodes[index] = {
        ...mineNode,
        position: { x: fields.x, y: fields.y },
        data: {
          ...(mineNode.data as object),
          sql: fields.sql,
          title: fields.title,
          blockType: fields.blockType,
        },
      };
    }
    merged.push({ ...page, nodes });
  }
  // A page only they have can't be placed into mine.
  if (theirs.pages.some((p) => !mine.some((m) => m.id === p.id))) return null;
  return merged;
}
