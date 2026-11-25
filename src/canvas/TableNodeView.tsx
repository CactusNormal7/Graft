import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type TableNode } from "../store/useGraftStore";

/** Columns listed before collapsing the rest into "+N more". */
const MAX_LISTED_COLUMNS = 12;

/**
 * A schema table on the canvas: name + columns (PK/FK flagged). SQL blocks
 * that reference it are linked to it by derived dashed edges
 * (`tableLinks.ts`). The column list comes from the introspected schema, so
 * it stays current after a migration.
 */
export function TableNodeView({ id, data, selected }: NodeProps<TableNode>) {
  const table = useGraftStore((s) =>
    s.dbSchema.find((t) => t.name === data.table && (t.schema ?? undefined) === data.schema),
  );
  const deleteBlock = useGraftStore((s) => s.deleteBlock);
  const addSelectBlock = useGraftStore((s) => s.addSelectBlock);

  const title = data.schema ? `${data.schema}.${data.table}` : data.table;
  const columns = table?.columns ?? [];
  const foreignKeyColumns = new Set(table?.foreign_keys.map((fk) => fk.column) ?? []);
  const hiddenCount = Math.max(0, columns.length - MAX_LISTED_COLUMNS);

  return (
    <div className={`table-node${selected ? " selected" : ""}${table ? "" : " is-missing"}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <header
        className="table-node__header"
        title="Double-click for a SELECT block"
        onDoubleClick={() => addSelectBlock(data.table, data.schema)}
      >
        <span className="table-node__kind">{table?.kind === "view" ? "view" : "table"}</span>
        <span className="table-node__name">{title}</span>
        <button
          className="btn sql-block__icon nodrag"
          title="Remove from canvas (the table itself is untouched)"
          onClick={() => deleteBlock(id)}
        >
          ✕
        </button>
      </header>
      {!table && <div className="table-node__missing">Not in the current schema</div>}
      <div className="table-node__columns">
        {columns.slice(0, MAX_LISTED_COLUMNS).map((column) => (
          <div key={column.name} className="table-node__column">
            <span className="table-node__column-name">{column.name}</span>
            {column.pk && <span className="schema-flag schema-flag--pk">PK</span>}
            {foreignKeyColumns.has(column.name) && <span className="schema-flag schema-flag--fk">FK</span>}
            <span className="table-node__type">{column.data_type}</span>
          </div>
        ))}
        {hiddenCount > 0 && <div className="table-node__more">+{hiddenCount} more</div>}
      </div>
    </div>
  );
}
