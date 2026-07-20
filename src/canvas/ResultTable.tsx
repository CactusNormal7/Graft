import { useState } from "react";
import type { QueryResult, ResultView } from "../types";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import {
  buildNestedGroups,
  detectNestedShape,
  type Cell,
  type NestedGroup,
} from "./resultShape";

interface ResultTableProps {
  result: QueryResult;
  view: ResultView;
}

interface CellCtx {
  col: string;
  value: Cell;
  rowIndex: number;
  row: Cell[];
  columns: string[];
}

export function ResultTable({ result, view }: ResultTableProps) {
  const [menu, setMenu] = useState<
    | { x: number; y: number; actions: MenuAction[] }
    | null
  >(null);

  const openCellMenu = (e: React.MouseEvent, ctx: CellCtx) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, actions: cellActions(ctx) });
  };

  const openRowMenu = (e: React.MouseEvent, ctx: Omit<CellCtx, "col" | "value">) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, actions: rowActions(ctx) });
  };

  const body = (() => {
    if (view === "nested") {
      const shape = detectNestedShape(result);
      if (shape) {
        return (
          <NestedView
            groups={buildNestedGroups(result, shape)}
            childLabel={shape.childLabel}
            onCellContextMenu={openCellMenu}
            columns={result.columns}
          />
        );
      }
      // No repetition to collapse → fall back to records so the user still
      // sees something useful.
      return (
        <RecordsView
          result={result}
          onCellContextMenu={openCellMenu}
          onRowContextMenu={openRowMenu}
        />
      );
    }
    if (view === "records") {
      return (
        <RecordsView
          result={result}
          onCellContextMenu={openCellMenu}
          onRowContextMenu={openRowMenu}
        />
      );
    }
    return (
      <TableView
        result={result}
        onCellContextMenu={openCellMenu}
        onRowContextMenu={openRowMenu}
      />
    );
  })();

  return (
    <>
      {body}
      {menu && (
        <BlockContextMenu
          x={menu.x}
          y={menu.y}
          actions={menu.actions}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

// ============================================================================
// Table view
// ============================================================================
function TableView({
  result,
  onCellContextMenu,
  onRowContextMenu,
}: {
  result: QueryResult;
  onCellContextMenu: (e: React.MouseEvent, ctx: CellCtx) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    ctx: Omit<CellCtx, "col" | "value">,
  ) => void;
}) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th className="result-table__rownum">#</th>
          {result.columns.map((col) => (
            <th key={col}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            <td
              className="result-table__rownum"
              onContextMenu={(e) =>
                onRowContextMenu(e, {
                  rowIndex: i,
                  row,
                  columns: result.columns,
                })
              }
            >
              {i + 1}
            </td>
            {row.map((cell, j) => (
              <CellTd
                key={j}
                value={cell}
                onContextMenu={(e) =>
                  onCellContextMenu(e, {
                    col: result.columns[j],
                    value: cell,
                    rowIndex: i,
                    row,
                    columns: result.columns,
                  })
                }
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellTd({
  value,
  onContextMenu,
}: {
  value: Cell;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  if (value === null) {
    return (
      <td className="is-null" onContextMenu={onContextMenu}>
        <em>null</em>
      </td>
    );
  }
  const isNumber = typeof value === "number";
  const text = String(value);
  return (
    <td
      className={isNumber ? "is-number" : undefined}
      title={text}
      onContextMenu={onContextMenu}
      onDoubleClick={() => void navigator.clipboard?.writeText(text)}
    >
      {text}
    </td>
  );
}

// ============================================================================
// Records view
// ============================================================================
function RecordsView({
  result,
  onCellContextMenu,
  onRowContextMenu,
}: {
  result: QueryResult;
  onCellContextMenu: (e: React.MouseEvent, ctx: CellCtx) => void;
  onRowContextMenu: (
    e: React.MouseEvent,
    ctx: Omit<CellCtx, "col" | "value">,
  ) => void;
}) {
  return (
    <div className="result-records">
      {result.rows.map((row, i) => (
        <div
          key={i}
          className="result-record"
          onContextMenu={(e) =>
            onRowContextMenu(e, { rowIndex: i, row, columns: result.columns })
          }
        >
          <div className="result-record__index">#{i + 1}</div>
          <div className="result-record__fields">
            {result.columns.map((col, j) => (
              <div
                key={col}
                className="result-record__field"
                onContextMenu={(e) =>
                  onCellContextMenu(e, {
                    col,
                    value: row[j],
                    rowIndex: i,
                    row,
                    columns: result.columns,
                  })
                }
              >
                <span className="result-record__key">{col}</span>
                <ValueCell value={row[j]} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Nested view — auto-collapsed join result, JSON-tree interactions
// ============================================================================
function NestedView({
  groups,
  childLabel,
  columns,
  onCellContextMenu,
}: {
  groups: NestedGroup[];
  childLabel: string;
  columns: string[];
  onCellContextMenu: (e: React.MouseEvent, ctx: CellCtx) => void;
}) {
  // Two tri-state stores keyed by the group index (parent) and by
  // "gi:ii" (individual child items). Default: parents expanded, items
  // collapsed to a one-line summary.
  const [groupClosed, setGroupClosed] = useState<Record<number, boolean>>({});
  const [itemOpen, setItemOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState<boolean | null>(null);

  const toggleGroup = (gi: number) =>
    setGroupClosed((p) => ({ ...p, [gi]: !p[gi] }));
  const toggleItem = (gi: number, ii: number) => {
    const key = `${gi}:${ii}`;
    setItemOpen((p) => ({ ...p, [key]: !isItemOpen(gi, ii, p) }));
  };
  const isItemOpen = (
    gi: number,
    ii: number,
    state: Record<string, boolean> = itemOpen,
  ) => {
    const explicit = state[`${gi}:${ii}`];
    if (explicit !== undefined) return explicit;
    return allOpen === true;
  };

  const expandAll = () => {
    setAllOpen(true);
    setGroupClosed({});
    setItemOpen({});
  };
  const collapseAll = () => {
    setAllOpen(false);
    setGroupClosed({});
    setItemOpen({});
  };

  return (
    <div className="result-nested">
      <div className="result-nested__toolbar">
        <button className="btn result-nested__tbtn" onClick={expandAll} title="Expand all">
          ▼ all
        </button>
        <button className="btn result-nested__tbtn" onClick={collapseAll} title="Collapse all">
          ▶ all
        </button>
        <span className="text-muted">
          {groups.length} group{groups.length > 1 ? "s" : ""}
        </span>
      </div>

      {groups.map((g, gi) => {
        const closed = groupClosed[gi] === true;
        return (
          <div key={gi} className="result-nested__group">
            <div className="result-nested__index">#{gi + 1}</div>
            <div className="result-nested__body">
              {g.parent.map((f) => (
                <div
                  key={f.colIndex}
                  className="result-nested__field"
                  onContextMenu={(e) =>
                    onCellContextMenu(e, {
                      col: f.key,
                      value: f.value,
                      rowIndex: gi,
                      row: [],
                      columns,
                    })
                  }
                >
                  <span className="result-nested__key">{f.key}</span>
                  <ValueCell value={f.value} />
                </div>
              ))}

              <div className="result-nested__sub">
                <button
                  className="result-nested__sub-title result-nested__sub-title--btn"
                  onClick={() => toggleGroup(gi)}
                  title={closed ? "Expand" : "Collapse"}
                >
                  <span className="result-nested__caret">{closed ? "▶" : "▼"}</span>
                  {childLabel}
                  <span className="result-nested__count">{g.children.length}</span>
                </button>

                {!closed && (
                  g.children.length === 0 ? (
                    <div className="result-nested__empty">—</div>
                  ) : (
                    <div className="result-nested__array">
                      {g.children.map((item, ii) => {
                        const open = isItemOpen(gi, ii);
                        const summary = summarizeItem(item);
                        return (
                          <div key={ii} className="result-nested__item">
                            <button
                              className="result-nested__item-head"
                              onClick={() => toggleItem(gi, ii)}
                              title={open ? "Collapse item" : "Expand item"}
                            >
                              <span className="result-nested__caret">
                                {open ? "▼" : "▶"}
                              </span>
                              <span className="result-nested__item-index">
                                {ii + 1}
                              </span>
                              {!open && (
                                <span className="result-nested__item-summary">
                                  {summary}
                                </span>
                              )}
                            </button>
                            {open && (
                              <div className="result-nested__sub-fields">
                                {item.map((f) => (
                                  <div
                                    key={f.colIndex}
                                    className="result-nested__field"
                                    onContextMenu={(e) =>
                                      onCellContextMenu(e, {
                                        col: f.key,
                                        value: f.value,
                                        rowIndex: gi,
                                        row: [],
                                        columns,
                                      })
                                    }
                                  >
                                    <span className="result-nested__key">
                                      {f.key}
                                    </span>
                                    <ValueCell value={f.value} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One-line preview of a child item — the first non-null field, plus a hint
 *  of the second if short. Shown when the item is collapsed. */
function summarizeItem(
  item: Array<{ key: string; value: Cell; colIndex: number }>,
): string {
  const nonNull = item.filter((f) => f.value !== null);
  if (nonNull.length === 0) return "—";
  const parts = nonNull.slice(0, 3).map((f) => {
    const v = String(f.value);
    return v.length > 30 ? v.slice(0, 30) + "…" : v;
  });
  return parts.join(" · ");
}

// ============================================================================
// Shared value cell
// ============================================================================
function ValueCell({ value }: { value: Cell }) {
  if (value === null) {
    return (
      <span className="result-record__val is-null">
        <em>null</em>
      </span>
    );
  }
  const isNumber = typeof value === "number";
  const text = String(value);
  return (
    <span
      className={`result-record__val${isNumber ? " is-number" : ""}`}
      onDoubleClick={() => void navigator.clipboard?.writeText(text)}
    >
      {text}
    </span>
  );
}

// ============================================================================
// Cell / row context-menu actions
// ============================================================================
function sqlLiteral(v: Cell): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function rowAsJson(row: Cell[], columns: string[]): string {
  const obj: Record<string, Cell> = {};
  columns.forEach((c, i) => (obj[c] = row[i]));
  return JSON.stringify(obj, null, 2);
}

function rowAsInsert(row: Cell[], columns: string[], table = "«table»"): string {
  const cols = columns.map(quoteIdent).join(", ");
  const vals = row.map(sqlLiteral).join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function cellActions(ctx: CellCtx): MenuAction[] {
  const { col, value, row, columns } = ctx;
  const where = `${quoteIdent(col)} = ${sqlLiteral(value)}`;
  const text = value === null ? "" : String(value);

  return [
    { label: "Copy value", onClick: () => copy(text), disabled: value === null },
    { label: "Copy column name", onClick: () => copy(col) },
    { label: "Copy as JSON", onClick: () => copy(JSON.stringify(value)) },
    { separator: true },
    { label: "Copy WHERE clause", onClick: () => copy(where) },
    {
      label: "Copy SELECT filter",
      onClick: () => copy(`SELECT * FROM «table» WHERE ${where};`),
    },
    {
      label: "Copy UPDATE template",
      onClick: () =>
        copy(
          `UPDATE «table» SET ${quoteIdent(col)} = ${sqlLiteral(value)} WHERE «pk» = «id»;`,
        ),
    },
    { separator: true },
    {
      label: "Copy row as JSON",
      onClick: () => copy(rowAsJson(row.length ? row : [], columns)),
      disabled: row.length === 0,
    },
    {
      label: "Copy row as INSERT",
      onClick: () => copy(rowAsInsert(row, columns)),
      disabled: row.length === 0,
    },
    { separator: true },
    { label: "Set NULL (in-place)", disabled: true },
    { label: "Open in new block", disabled: true },
  ];
}

function rowActions(ctx: Omit<CellCtx, "col" | "value">): MenuAction[] {
  const { row, columns } = ctx;
  return [
    { label: "Copy row as JSON", onClick: () => copy(rowAsJson(row, columns)) },
    { label: "Copy row as INSERT", onClick: () => copy(rowAsInsert(row, columns)) },
    {
      label: "Copy row as TSV",
      onClick: () => copy(row.map((v) => (v === null ? "" : String(v))).join("\t")),
    },
    { separator: true },
    { label: "Duplicate row (in-place)", disabled: true },
    { label: "Delete row", disabled: true, danger: true },
  ];
}
