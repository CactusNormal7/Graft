/** Pure helpers behind the schema explorer (`Sidebar.tsx`): grouping,
 *  search filtering and display strings for introspected objects. */
import type {
  IndexInfo,
  RoutineInfo,
  SchemaObjects,
  TableInfo,
  TriggerInfo,
} from "../types";

export interface ExplorerSections {
  tables: TableInfo[];
  views: TableInfo[];
  triggers: TriggerInfo[];
  routines: RoutineInfo[];
}

/** Unique key / display name: `schema.name`, or `name` in the default schema. */
export function objectKey(object: { name: string; schema?: string }): string {
  return object.schema ? `${object.schema}.${object.name}` : object.name;
}

const byKey = <T extends { name: string; schema?: string }>(a: T, b: T) =>
  objectKey(a).localeCompare(objectKey(b));

function includes(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

/** True when a column of the table/view matches the (lowercase) query. */
export function hasMatchingColumn(table: TableInfo, query: string): boolean {
  return query !== "" && table.columns.some((c) => includes(c.name, query));
}

/** Sections of the explorer, sorted, keeping only what matches `query`
 *  (object names; for tables/views, column names too; for triggers, their
 *  table). An empty query keeps everything. */
export function explorerSections(
  tables: TableInfo[],
  objects: SchemaObjects,
  query: string,
): ExplorerSections {
  const q = query.trim().toLowerCase();
  const keepTable = (t: TableInfo) => !q || includes(objectKey(t), q) || hasMatchingColumn(t, q);
  const relations = tables.filter(keepTable).sort(byKey);
  return {
    tables: relations.filter((t) => t.kind !== "view"),
    views: relations.filter((t) => t.kind === "view"),
    triggers: objects.triggers
      .filter((t) => !q || includes(objectKey(t), q) || includes(t.table, q))
      .sort(byKey),
    routines: objects.routines.filter((r) => !q || includes(objectKey(r), q)).sort(byKey),
  };
}

/** `UNIQUE (a, b)`, `PRIMARY KEY (id)`, `(created_at)`. */
export function describeIndex(index: IndexInfo): string {
  const columns = `(${index.columns.join(", ")})`;
  if (index.primary) return `PRIMARY KEY ${columns}`;
  return index.unique ? `UNIQUE ${columns}` : columns;
}

/** `AFTER INSERT, UPDATE ON orders`. */
export function describeTrigger(trigger: TriggerInfo): string {
  return `${trigger.timing} ${trigger.events} ON ${trigger.table}`.trim();
}

/** `total_for(customer integer) → numeric`. */
export function describeRoutine(routine: RoutineInfo): string {
  const signature = `${routine.name}(${routine.arguments})`;
  return routine.returns ? `${signature} → ${routine.returns}` : signature;
}
