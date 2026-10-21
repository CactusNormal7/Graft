import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChartConfig, QueryResult, ResultView } from "../types";
import { quoteIdent, sqlEquals, sqlLiteral } from "../sqlFormat";
import { useGraftStore } from "../store/useGraftStore";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import { ChartView } from "./ChartView";
import { JsonTreeView } from "./JsonTreeView";
import { copyToClipboard as copy } from "./clipboard";
import {
  buildNestedGroups,
  detectNestedShape,
  rowToObject,
  uniqueKey,
  type Cell,
  type NestedGroup,
  type NestedShape,
} from "./resultShape";
import {
  deleteRowSql,
  deleteRowsSql,
  duplicateRowSql,
  duplicateRowsSql,
  isKeyColumn,
  resolveRowTarget,
  rowKeyCondition,
  selectRowSql,
  selectRowsSql,
  updateCellRowsSql,
  updateCellSql,
  type RowTarget,
  type RowTargetResult,
} from "./rowSql";
import {
  EMPTY_SELECTION,
  clickRow,
  contextRow,
  orderedRows,
  selectAll,
  type RowSelection,
} from "./rowSelection";

interface ResultTableProps {
  result: QueryResult;
  view: ResultView;
  /** Chart-view config (persisted on the block); undefined until first shown. */
  chartConfig?: ChartConfig;
  /** Called when the user edits the chart config from the chart view. */
  onChartConfigChange?: (config: ChartConfig) => void;
}

interface RowCtx {
  rowIndex: number;
  row: Cell[];
  columns: string[];
}

interface CellCtx extends RowCtx {
  col: string;
  colIndex: number;
  value: Cell;
}

/** What the context-menu actions need beyond the clicked cell/row. */
interface ActionEnv {
  /** Table the result's rows can be written back to (or why not). */
  target: RowTargetResult;
  /** Open generated SQL in a new block. */
  openSql: (title: string, sql: string) => void;
}

/** Default rows (or JSON items) shown per page. */
const DEFAULT_PAGE_SIZE = 100;
type PageSize = number | "all";
const PAGE_SIZES: PageSize[] = [50, 100, 500, "all"];

export const ResultTable = memo(function ResultTable({
  result,
  view,
  chartConfig,
  onChartConfigChange,
}: ResultTableProps) {
  const [menu, setMenu] = useState<
    | { x: number; y: number; actions: MenuAction[] }
    | null
  >(null);

  const dbSchema = useGraftStore((s) => s.dbSchema);
  const openSqlBlock = useGraftStore((s) => s.openSqlBlock);
  const target = useMemo(
    () => resolveRowTarget(result.columns, dbSchema),
    [result.columns, dbSchema],
  );
  const env: ActionEnv = {
    target,
    openSql: (title, sql) => openSqlBlock(title, sql, "script"),
  };

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  // Selected rows (table view), as absolute indexes so paging keeps them.
  const [selection, setSelection] = useState<RowSelection>(EMPTY_SELECTION);
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelection(EMPTY_SELECTION);
  }, [result]);
  const rowsOf = (sel: RowSelection) => orderedRows(sel).map((i) => result.rows[i]);

  // Detect + group once per result. This keeps row *references* only — no
  // per-cell objects — so a 50k-row join stays cheap.
  const nested = useMemo(() => {
    if (view !== "json") return null;
    const shape = detectNestedShape(result);
    if (!shape) return null;
    return { shape, groups: buildNestedGroups(result, shape) };
  }, [result, view]);

  const isChart = view === "chart";
  const isJson = view === "json";
  const total = isChart
    ? 0
    : isJson && nested
    ? nested.groups.length
    : result.rows.length;

  // Reset to the first page whenever the data, the view, or the page size
  // changes (each can change what "page 0" means).
  useEffect(() => {
    setPage(0);
  }, [result, view, pageSize]);

  const size = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * size;
  const end = Math.min(start + size, total);

  // Right-click acts on the whole selection when the row is part of it,
  // otherwise the clicked row becomes the selection (as in a file manager).
  const openCellMenu = (e: React.MouseEvent, ctx: CellCtx) => {
    e.preventDefault();
    e.stopPropagation();
    const next = contextRow(selection, ctx.rowIndex);
    setSelection(next);
    const actions =
      next.rows.size > 1
        ? selectionCellActions(ctx, rowsOf(next), env)
        : cellActions(ctx, env);
    setMenu({ x: e.clientX, y: e.clientY, actions });
  };

  const openRowMenu = (e: React.MouseEvent, ctx: RowCtx) => {
    e.preventDefault();
    e.stopPropagation();
    const next = contextRow(selection, ctx.rowIndex);
    setSelection(next);
    const actions =
      next.rows.size > 1 ? selectionActions(rowsOf(next), ctx.columns, env) : rowActions(ctx, env);
    setMenu({ x: e.clientX, y: e.clientY, actions });
  };

  const onRowClick = (e: React.MouseEvent, rowIndex: number) => {
    setSelection((s) =>
      clickRow(s, rowIndex, { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey }),
    );
    // Focus the result so ⌘A / ⌘C / Esc apply to it.
    viewRef.current?.focus({ preventScroll: true });
  };

  /** Menu for the selection bar's "Actions" button. */
  const openSelectionMenu = (e: React.MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rows = rowsOf(selection);
    const actions =
      rows.length === 1
        ? rowActions({ rowIndex: orderedRows(selection)[0], row: rows[0], columns: result.columns }, env)
        : selectionActions(rows, result.columns, env);
    setMenu({ x: box.left, y: box.bottom, actions });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isChart || isJson) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "a") {
      e.preventDefault();
      e.stopPropagation();
      setSelection(selectAll(result.rows.length));
    } else if (mod && key === "c" && selection.rows.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      copy(rowsAsTsv(rowsOf(selection), result.columns, true));
    } else if (key === "escape" && selection.rows.size > 0) {
      e.stopPropagation();
      setSelection(EMPTY_SELECTION);
    }
  };

  const pagedFlat: QueryResult = useMemo(
    () => ({ ...result, rows: result.rows.slice(start, end) }),
    [result, start, end],
  );

  // Materialize objects ONLY for the visible page — never the whole result.
  const pagedJson = useMemo(() => {
    if (!isJson) return null;
    const cols = result.columns;
    if (nested) {
      return nested.groups
        .slice(start, end)
        .map((g) => groupToObject(g, nested.shape, cols));
    }
    return result.rows.slice(start, end).map((row) => rowToObject(row, cols));
  }, [isJson, nested, result, start, end]);

  const body = (() => {
    if (isChart) {
      return (
        <ChartView
          result={result}
          config={chartConfig}
          onChange={onChartConfigChange}
        />
      );
    }
    if (isJson) {
      return <JsonTreeView items={pagedJson ?? []} />;
    }
    return (
      <TableView
        result={pagedFlat}
        rowOffset={start}
        selected={selection.rows}
        onRowClick={onRowClick}
        onCellContextMenu={openCellMenu}
        onRowContextMenu={openRowMenu}
      />
    );
  })();

  // Show the pager once there's more than a default page worth of data, or
  // whenever the chosen page size splits the result (a smaller size picked on
  // a previous, larger result must not hide rows). Never in chart view, which
  // plots the whole result.
  const showPager = !isChart && (total > DEFAULT_PAGE_SIZE || pageCount > 1);
  const selectedCount = !isChart && !isJson ? selection.rows.size : 0;

  return (
    // Focusable (not tabbable) so the selection shortcuts reach it.
    <div className="result-view" ref={viewRef} tabIndex={-1} onKeyDown={onKeyDown}>
      {/* The scrolling area is INSIDE this column, so the pager below is a
          plain flex sibling that can never drift over the content. */}
      <div className="result-view__body">{body}</div>
      {selectedCount > 0 && (
        <div className="result-selection nodrag">
          <span className="result-selection__count">
            {selectedCount} row{selectedCount > 1 ? "s" : ""} selected
          </span>
          <button className="btn result-pager__btn" onClick={openSelectionMenu}>
            Actions ▾
          </button>
          <button
            className="btn result-pager__btn"
            onClick={() => setSelection(EMPTY_SELECTION)}
            title="Clear the selection (Esc)"
          >
            Clear
          </button>
          <span className="text-muted result-selection__hint">
            ⇧-click range · ⌘/Ctrl-click toggle · ⌘C copy
          </span>
        </div>
      )}
      {showPager && (
        <div className="result-pager nodrag">
          <button
            className="btn result-pager__btn"
            disabled={clampedPage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            title="Previous page"
          >
            ‹
          </button>
          <span className="result-pager__range">
            {total === 0 ? "0" : `${start + 1}–${end}`}{" "}
            <span className="text-muted">/ {total}</span>
          </span>
          <button
            className="btn result-pager__btn"
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            title="Next page"
          >
            ›
          </button>
          <select
            className="result-pager__size"
            value={String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === "all" ? "all" : Number(v));
            }}
            title="Items per page"
          >
            {PAGE_SIZES.map((s) => (
              <option key={String(s)} value={String(s)}>
                {s === "all" ? "All" : s}
              </option>
            ))}
          </select>
          <span className="text-muted result-pager__unit">
            {isJson ? "items" : "rows"}/page
          </span>
        </div>
      )}
      {menu && (
        <BlockContextMenu
          x={menu.x}
          y={menu.y}
          actions={menu.actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
});

// ============================================================================
// Table view
// ============================================================================
function TableView({
  result,
  rowOffset,
  selected,
  onRowClick,
  onCellContextMenu,
  onRowContextMenu,
}: {
  result: QueryResult;
  rowOffset: number;
  selected: ReadonlySet<number>;
  onRowClick: (e: React.MouseEvent, rowIndex: number) => void;
  onCellContextMenu: (e: React.MouseEvent, ctx: CellCtx) => void;
  onRowContextMenu: (e: React.MouseEvent, ctx: RowCtx) => void;
}) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th className="result-table__rownum">#</th>
          {result.columns.map((col, j) => (
            // Index key: column names may repeat (`SELECT a.id, b.id`).
            <th key={j}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => {
          const abs = rowOffset + i;
          return (
            <tr
              key={abs}
              className={selected.has(abs) ? "is-selected" : undefined}
              aria-selected={selected.has(abs)}
              // Shift-click extends the row selection, not a text selection.
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              onClick={(e) => onRowClick(e, abs)}
            >
              <td
                className="result-table__rownum"
                onContextMenu={(e) =>
                  onRowContextMenu(e, {
                    rowIndex: abs,
                    row,
                    columns: result.columns,
                  })
                }
              >
                {abs + 1}
              </td>
              {row.map((cell, j) => (
                <CellTd
                  key={j}
                  value={cell}
                  onContextMenu={(e) =>
                    onCellContextMenu(e, {
                      col: result.columns[j],
                      colIndex: j,
                      value: cell,
                      rowIndex: abs,
                      row,
                      columns: result.columns,
                    })
                  }
                />
              ))}
            </tr>
          );
        })}
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
      onDoubleClick={() => copy(text)}
    >
      {text}
    </td>
  );
}

// ============================================================================
// Shared helpers
// ============================================================================
/** Rebuild a nested group into a plain JSON object: parent fields + a child
 *  array under the detected label. Column order is preserved. Called only for
 *  the groups currently on screen. */
function groupToObject(
  g: NestedGroup,
  shape: NestedShape,
  columns: string[],
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const i of shape.parentIndexes) o[uniqueKey(o, columns[i])] = g.parent[i];
  o[uniqueKey(o, shape.childLabel)] = g.children.map((row) => {
    const c: Record<string, Cell> = {};
    for (const i of shape.childIndexes) c[uniqueKey(c, columns[i])] = row[i];
    return c;
  });
  return o;
}

// ============================================================================
// Cell / row context-menu actions (table view)
// ============================================================================
function rowAsJson(row: Cell[], columns: string[]): string {
  return JSON.stringify(rowToObject(row, columns), null, 2);
}

function rowAsInsert(row: Cell[], columns: string[], table: string): string {
  const cols = columns.map(quoteIdent).join(", ");
  const vals = row.map(sqlLiteral).join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
}

/** One TSV field: quoted (spreadsheet-style) when it holds a tab, a newline
 *  or a quote, so pasting into a spreadsheet keeps the columns aligned. */
function tsvField(v: Cell): string {
  const text = v === null ? "" : String(v);
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsAsTsv(rows: Cell[][], columns: string[], header: boolean): string {
  const lines = rows.map((r) => r.map(tsvField).join("\t"));
  return (header ? [columns.map(tsvField).join("\t"), ...lines] : lines).join("\n");
}

/** Quoted target table name, or a placeholder to fill in by hand. */
function tableOrPlaceholder(env: ActionEnv): string {
  return env.target.ok ? quoteIdent(env.target.target.table) : "«table»";
}

/** A "→ new block" row action, disabled (with the reason) without a target. */
function rowAction(
  env: ActionEnv,
  label: string,
  build: (t: RowTarget) => { title: string; sql: string },
  danger = false,
): MenuAction {
  if (!env.target.ok) return { label, danger, disabled: true, hint: env.target.reason };
  const target = env.target.target;
  return {
    label,
    danger,
    onClick: () => {
      const { title, sql } = build(target);
      env.openSql(title, sql);
    },
  };
}

function cellActions(ctx: CellCtx, env: ActionEnv): MenuAction[] {
  const { col, colIndex, value, row, columns } = ctx;
  const where = sqlEquals(col, value);
  const text = value === null ? "" : String(value);
  const table = tableOrPlaceholder(env);
  const keyWhere = env.target.ok
    ? rowKeyCondition(env.target.target, row, columns)
    : "«pk» = «id»";
  const isKey = env.target.ok && isKeyColumn(env.target.target, colIndex);

  return [
    { label: "Copy value", onClick: () => copy(text), disabled: value === null },
    { label: "Copy column name", onClick: () => copy(col) },
    { label: "Copy as JSON", onClick: () => copy(JSON.stringify(value)) },
    { separator: true },
    { label: "Copy WHERE clause", onClick: () => copy(where) },
    {
      label: "Copy SELECT filter",
      onClick: () => copy(`SELECT * FROM ${table} WHERE ${where};`),
    },
    {
      label: "Copy UPDATE template",
      onClick: () =>
        copy(`UPDATE ${table} SET ${quoteIdent(col)} = ${sqlLiteral(value)} WHERE ${keyWhere};`),
    },
    { separator: true },
    { label: "Copy row as JSON", onClick: () => copy(rowAsJson(row, columns)) },
    { label: "Copy row as INSERT", onClick: () => copy(rowAsInsert(row, columns, table)) },
    { separator: true },
    isKey || value === null
      ? {
          label: "Set NULL → new block",
          disabled: true,
          hint: isKey ? "A primary-key column can't be set to NULL." : "The value is already NULL.",
        }
      : rowAction(env, "Set NULL → new block", (t) => ({
          title: `Set ${col} NULL — ${t.table}`,
          sql: updateCellSql(t, row, columns, colIndex, null),
        })),
    rowAction(env, "Open row in new block", (t) => ({
      title: `Row — ${t.table}`,
      sql: selectRowSql(t, row, columns),
    })),
  ];
}

function rowActions(ctx: RowCtx, env: ActionEnv): MenuAction[] {
  const { row, columns } = ctx;
  return [
    { label: "Copy row as JSON", onClick: () => copy(rowAsJson(row, columns)) },
    {
      label: "Copy row as INSERT",
      onClick: () => copy(rowAsInsert(row, columns, tableOrPlaceholder(env))),
    },
    { label: "Copy row as TSV", onClick: () => copy(rowsAsTsv([row], columns, false)) },
    { separator: true },
    rowAction(env, "Open row in new block", (t) => ({
      title: `Row — ${t.table}`,
      sql: selectRowSql(t, row, columns),
    })),
    rowAction(env, "Duplicate row → new block", (t) => ({
      title: `Duplicate row — ${t.table}`,
      sql: duplicateRowSql(t, row, columns),
    })),
    rowAction(
      env,
      "Delete row → new block",
      (t) => ({ title: `Delete row — ${t.table}`, sql: deleteRowSql(t, row, columns) }),
      true,
    ),
  ];
}

// ============================================================================
// Multi-row selection actions
// ============================================================================
const plural = (n: number) => `${n} row${n > 1 ? "s" : ""}`;

/** Actions on every selected row. Writes open reviewable SQL in a new block,
 *  like the single-row actions. */
function selectionActions(rows: Cell[][], columns: string[], env: ActionEnv): MenuAction[] {
  const n = plural(rows.length);
  const table = tableOrPlaceholder(env);
  return [
    {
      label: `Copy ${n} as JSON`,
      onClick: () => copy(JSON.stringify(rows.map((r) => rowToObject(r, columns)), null, 2)),
    },
    {
      label: `Copy ${n} as INSERT`,
      onClick: () => copy(rows.map((r) => rowAsInsert(r, columns, table)).join("\n")),
    },
    { label: `Copy ${n} as TSV`, onClick: () => copy(rowsAsTsv(rows, columns, true)) },
    { separator: true },
    rowAction(env, `Open ${n} in new block`, (t) => ({
      title: `${n} — ${t.table}`,
      sql: selectRowsSql(t, rows, columns),
    })),
    rowAction(env, `Duplicate ${n} → new block`, (t) => ({
      title: `Duplicate ${n} — ${t.table}`,
      sql: duplicateRowsSql(t, rows, columns),
    })),
    rowAction(
      env,
      `Delete ${n} → new block`,
      (t) => ({ title: `Delete ${n} — ${t.table}`, sql: deleteRowsSql(t, rows, columns) }),
      true,
    ),
  ];
}

/** Right-click on a cell of a multi-row selection: the cell's own copies,
 *  "Set NULL" on that column for every selected row, then the row actions. */
function selectionCellActions(ctx: CellCtx, rows: Cell[][], env: ActionEnv): MenuAction[] {
  const { col, colIndex, value, columns } = ctx;
  const label = `Set ${col} NULL on ${plural(rows.length)} → new block`;
  const isKey = env.target.ok && isKeyColumn(env.target.target, colIndex);
  return [
    { label: "Copy value", onClick: () => copy(value === null ? "" : String(value)), disabled: value === null },
    { label: "Copy column name", onClick: () => copy(col) },
    {
      label: `Copy ${col} of ${plural(rows.length)}`,
      onClick: () => copy(rows.map((r) => tsvField(r[colIndex])).join("\n")),
    },
    { separator: true },
    isKey
      ? { label, disabled: true, hint: "A primary-key column can't be set to NULL." }
      : rowAction(env, label, (t) => ({
          title: `Set ${col} NULL — ${t.table}`,
          sql: updateCellRowsSql(t, rows, columns, colIndex, null),
        })),
    { separator: true },
    ...selectionActions(rows, columns, env),
  ];
}
