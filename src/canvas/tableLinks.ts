/**
 * Derived edges between SQL blocks and the table nodes of the page: a dashed
 * link for each table a block's SQL references. Computed from the SQL on
 * every render, never stored or saved — they mirror the SQL, the user does
 * not draw them. Purely visual: no execution order is implied.
 */
import type { Edge, Node } from "@xyflow/react";
import { referencedTableKeys, tableKey } from "./tableRefs";
import type { DbSchema, SqlBlockData, TableNodeData } from "../types";

export const TABLE_LINK_PREFIX = "table-link:";

const LINK_STYLE = { stroke: "var(--info)", strokeDasharray: "4 4", strokeWidth: 1.5 };

/** Parsed references per SQL text, per schema snapshot: dragging a block
 *  re-renders the canvas many times per second without re-scanning SQL. */
const referenceCache = new WeakMap<DbSchema, Map<string, string[]>>();

function cachedReferences(sql: string, schema: DbSchema): string[] {
  let bySql = referenceCache.get(schema);
  if (!bySql) {
    bySql = new Map();
    referenceCache.set(schema, bySql);
  }
  let keys = bySql.get(sql);
  if (!keys) {
    keys = referencedTableKeys(sql, schema);
    bySql.set(sql, keys);
  }
  return keys;
}

export function isTableLink(edgeId: string): boolean {
  return edgeId.startsWith(TABLE_LINK_PREFIX);
}

/** Table keys referenced by SQL blocks of `nodes`, in first-seen order. */
export function referencedKeysOnPage(nodes: Node[], schema: DbSchema): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (node.type !== "sqlBlock") continue;
    for (const key of cachedReferences((node.data as SqlBlockData).sql, schema)) keys.add(key);
  }
  return [...keys];
}

export function tableLinkEdges(nodes: Node[], schema: DbSchema): Edge[] {
  const tableNodeIds = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== "tableNode") continue;
    const { table, schema: tableSchema } = node.data as TableNodeData;
    tableNodeIds.set(tableKey({ name: table, schema: tableSchema }), node.id);
  }
  if (tableNodeIds.size === 0) return [];

  const edges: Edge[] = [];
  for (const node of nodes) {
    if (node.type !== "sqlBlock") continue;
    for (const key of cachedReferences((node.data as SqlBlockData).sql, schema)) {
      const tableNodeId = tableNodeIds.get(key);
      if (!tableNodeId) continue;
      // Drawn table → block: table nodes sit left of the blocks they serve.
      edges.push({
        id: `${TABLE_LINK_PREFIX}${tableNodeId}->${node.id}`,
        source: tableNodeId,
        target: node.id,
        selectable: false,
        deletable: false,
        focusable: false,
        style: LINK_STYLE,
        className: "table-link",
      });
    }
  }
  return edges;
}
