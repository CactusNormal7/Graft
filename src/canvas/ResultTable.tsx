import { memo, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as PieCell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartConfig, ChartType, QueryResult, ResultView } from "../types";
import { quoteIdent, sqlLiteral } from "../sqlFormat";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import {
  buildNestedGroups,
  detectNestedShape,
  type Cell,
  type NestedGroup,
  type NestedShape,
} from "./resultShape";

interface ResultTableProps {
  result: QueryResult;
  view: ResultView;
  /** Chart-view config (persisted on the block); undefined until first shown. */
  chartConfig?: ChartConfig;
  /** Called when the user edits the chart config from the chart view. */
  onChartConfigChange?: (config: ChartConfig) => void;
}

interface CellCtx {
  col: string;
  value: Cell;
  rowIndex: number;
  row: Cell[];
  columns: string[];
}

/** Default rows (or JSON items) shown per page. */
const DEFAULT_PAGE_SIZE = 100;
type PageSize = number | "all";
const PAGE_SIZES: PageSize[] = [50, 100, 500, "all"];

/** Max marks plotted in the chart view (readability + render cost). */
const CHART_MAX_POINTS = 500;
/** Rows sampled when inferring which columns are numeric. */
const NUMERIC_SCAN_ROWS = 200;

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

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

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
        onCellContextMenu={openCellMenu}
        onRowContextMenu={openRowMenu}
      />
    );
  })();

  // Only show the pager once there's more than a default page worth of data
  // (never in chart view, which plots the whole result).
  const showPager = !isChart && total > DEFAULT_PAGE_SIZE;

  return (
    <div className="result-view">
      {/* The scrolling area is INSIDE this column, so the pager below is a
          plain flex sibling that can never drift over the content. */}
      <div className="result-view__body">{body}</div>
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
                {s === "all" ? "Tout" : s}
              </option>
            ))}
          </select>
          <span className="text-muted result-pager__unit">
            {isJson ? "éléments" : "lignes"}/page
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
  onCellContextMenu,
  onRowContextMenu,
}: {
  result: QueryResult;
  rowOffset: number;
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
        {result.rows.map((row, i) => {
          const abs = rowOffset + i;
          return (
            <tr key={abs}>
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
      onDoubleClick={() => void navigator.clipboard?.writeText(text)}
    >
      {text}
    </td>
  );
}

// ============================================================================
// JSON view — interactive tree (fold/unfold like a JSON editor).
// Feeds on either the re-nested relational document or the flat row objects.
// ============================================================================
type FoldMode = "auto" | "open" | "closed";

function JsonTreeView({ items }: { items: unknown[] }) {
  const [mode, setMode] = useState<FoldMode>("auto");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Reset fold state when the shown slice changes (new query / page).
  useEffect(() => {
    setMode("auto");
    setOverrides({});
  }, [items]);

  const isOpen = (path: string, depth: number): boolean => {
    if (path in overrides) return overrides[path];
    if (mode === "open") return true;
    if (mode === "closed") return depth < 1; // keep the root array open
    return depth < 2; // auto: root + first level open, deeper collapsed
  };
  const toggle = (path: string, depth: number) =>
    setOverrides((o) => ({ ...o, [path]: !isOpen(path, depth) }));

  return (
    <div className="jsonx">
      <div className="jsonx__toolbar">
        <button
          className="btn jsonx__tbtn"
          onClick={() => {
            setMode("open");
            setOverrides({});
          }}
          title="Expand all"
        >
          ▼ all
        </button>
        <button
          className="btn jsonx__tbtn"
          onClick={() => {
            setMode("closed");
            setOverrides({});
          }}
          title="Collapse all"
        >
          ▶ all
        </button>
        <span className="text-muted">
          {items.length} élément{items.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="jsonx__body">
        <JsonNode
          keyName={undefined}
          value={items}
          depth={0}
          path=""
          isOpen={isOpen}
          toggle={toggle}
          isLast
        />
      </div>
    </div>
  );
}

function JsonNode({
  keyName,
  value,
  depth,
  path,
  isOpen,
  toggle,
  isLast,
}: {
  keyName: string | undefined;
  value: unknown;
  depth: number;
  path: string;
  isOpen: (path: string, depth: number) => boolean;
  toggle: (path: string, depth: number) => void;
  isLast: boolean;
}) {
  const comma = isLast ? "" : ",";
  const indent: React.CSSProperties = { paddingLeft: 6 + depth * 14 };
  const keyEl =
    keyName !== undefined ? (
      <>
        <span className="json-key">"{keyName}"</span>
        <span className="json-punct">: </span>
      </>
    ) : null;

  const isObject = value !== null && typeof value === "object";
  if (!isObject) {
    return (
      <div className="jsonx-row" style={indent}>
        <span className="jsonx-caret jsonx-caret--empty" />
        {keyEl}
        <JsonScalar value={value as Cell} />
        <span className="json-punct">{comma}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const open = isOpen(path, depth);
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  if (!open) {
    return (
      <div className="jsonx-row" style={indent}>
        <button className="jsonx-caret" onClick={() => toggle(path, depth)}>
          ▶
        </button>
        {keyEl}
        <span className="json-punct">{openBrace}</span>
        <button className="jsonx-collapsed" onClick={() => toggle(path, depth)}>
          {isArray ? `${entries.length} items` : `${entries.length} keys`}
        </button>
        <span className="json-punct">
          {closeBrace}
          {comma}
        </span>
      </div>
    );
  }

  return (
    <div className="jsonx-branch">
      <div className="jsonx-row" style={indent}>
        <button className="jsonx-caret" onClick={() => toggle(path, depth)}>
          ▼
        </button>
        {keyEl}
        <span className="json-punct">{openBrace}</span>
      </div>
      {entries.map(([k, v], i) => (
        <JsonNode
          key={k}
          keyName={isArray ? undefined : k}
          value={v}
          depth={depth + 1}
          path={`${path}/${k}`}
          isOpen={isOpen}
          toggle={toggle}
          isLast={i === entries.length - 1}
        />
      ))}
      <div className="jsonx-row" style={indent}>
        <span className="jsonx-caret jsonx-caret--empty" />
        <span className="json-punct">
          {closeBrace}
          {comma}
        </span>
      </div>
    </div>
  );
}

function JsonScalar({ value }: { value: Cell }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "number")
    return <span className="json-number">{String(value)}</span>;
  if (typeof value === "boolean")
    return <span className="json-bool">{String(value)}</span>;
  const text = String(value);
  return (
    <span
      className="json-string"
      title="Double-click to copy"
      onDoubleClick={() => copy(text)}
    >
      "{text}"
    </span>
  );
}

// ============================================================================
// Chart view — plot the result (bar / line / area / pie)
// ============================================================================
function ChartView({
  result,
  config,
  onChange,
}: {
  result: QueryResult;
  config?: ChartConfig;
  onChange?: (c: ChartConfig) => void;
}) {
  const columns = result.columns;
  const numericCols = useMemo(() => numericColumns(result), [result]);
  const cfg = useMemo(
    () => sanitizeConfig(config, result, numericCols),
    [config, result, numericCols],
  );
  // Plotting tens of thousands of marks is unreadable AND freezes the canvas —
  // cap the series and say so.
  const truncated = result.rows.length > CHART_MAX_POINTS;
  const data = useMemo(
    () =>
      result.rows
        .slice(0, CHART_MAX_POINTS)
        .map((row) => rowToObject(row, result.columns)),
    [result],
  );

  // Colors/ink read from the live CSS tokens (once per mount — getComputedStyle
  // forces a style recalc, so it must not run on every render).
  const theme = useMemo(() => {
    const gridColor = readVar("--border", "#2d3242");
    return {
      palette: readPalette(),
      axisColor: readVar("--muted", "#8b91a3"),
      gridColor,
      tooltipStyle: {
        background: readVar("--panel", "#1a1d27"),
        border: `1px solid ${gridColor}`,
        borderRadius: 6,
        fontSize: 12,
        color: readVar("--text-2", "#b8bece"),
      } as React.CSSProperties,
    };
  }, []);
  const { palette, axisColor, gridColor, tooltipStyle } = theme;

  const yCandidates = numericCols.length ? numericCols : columns;
  const update = (patch: Partial<ChartConfig>) => onChange?.({ ...cfg, ...patch });
  const toggleY = (col: string) => {
    if (cfg.type === "pie") {
      update({ yCols: [col] });
      return;
    }
    const next = cfg.yCols.includes(col)
      ? cfg.yCols.filter((c) => c !== col)
      : [...cfg.yCols, col];
    if (next.length) update({ yCols: next });
  };

  const canPlot = cfg.xCol && cfg.yCols.length > 0 && data.length > 0;

  return (
    <div className="result-chart nodrag">
      <div className="result-chart__cfg">
        <select
          className="result-chart__sel"
          value={cfg.type}
          onChange={(e) => update({ type: e.target.value as ChartType })}
          title="Chart type"
        >
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="pie">Pie</option>
        </select>
        <span className="result-chart__lbl">X</span>
        <select
          className="result-chart__sel"
          value={cfg.xCol}
          onChange={(e) => update({ xCol: e.target.value })}
          title="X axis / labels"
        >
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="result-chart__lbl">{cfg.type === "pie" ? "Val" : "Y"}</span>
        <div className="result-chart__ys">
          {yCandidates.map((c) => (
            <button
              key={c}
              className={`result-chart__chip${cfg.yCols.includes(c) ? " is-on" : ""}`}
              onClick={() => toggleY(c)}
              title={`Toggle series: ${c}`}
            >
              {c}
            </button>
          ))}
        </div>
        {truncated && (
          <span className="text-muted result-chart__note">
            {CHART_MAX_POINTS} premiers points sur {result.rows.length}
          </span>
        )}
      </div>
      <div className="result-chart__area">
        {canPlot ? (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart(cfg, data, palette, axisColor, gridColor, tooltipStyle)}
          </ResponsiveContainer>
        ) : (
          <div className="result-chart__empty">
            Choisis une colonne X et au moins une série Y.
          </div>
        )}
      </div>
    </div>
  );
}

/** Build the concrete Recharts element for the active config. */
function renderChart(
  cfg: ChartConfig,
  data: Record<string, Cell>[],
  palette: string[],
  axisColor: string,
  gridColor: string,
  tooltipStyle: React.CSSProperties,
): React.ReactElement {
  const tick = { fill: axisColor, fontSize: 11 };
  const showLegend = cfg.yCols.length > 1;
  const margin = { top: 8, right: 12, bottom: 4, left: 0 };

  if (cfg.type === "pie") {
    return (
      <PieChart margin={margin}>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
        <Pie
          data={data}
          dataKey={cfg.yCols[0]}
          nameKey={cfg.xCol}
          outerRadius="80%"
          stroke={gridColor}
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <PieCell key={i} fill={palette[i % palette.length]} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  if (cfg.type === "line") {
    return (
      <LineChart data={data} margin={margin}>
        <CartesianGrid stroke={gridColor} vertical={false} />
        <XAxis dataKey={cfg.xCol} tick={tick} stroke={axisColor} />
        <YAxis tick={tick} stroke={axisColor} width={44} />
        <Tooltip contentStyle={tooltipStyle} />
        {showLegend && <Legend />}
        {cfg.yCols.map((c, i) => (
          <Line
            key={c}
            type="monotone"
            dataKey={c}
            stroke={palette[i % palette.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    );
  }

  if (cfg.type === "area") {
    return (
      <AreaChart data={data} margin={margin}>
        <CartesianGrid stroke={gridColor} vertical={false} />
        <XAxis dataKey={cfg.xCol} tick={tick} stroke={axisColor} />
        <YAxis tick={tick} stroke={axisColor} width={44} />
        <Tooltip contentStyle={tooltipStyle} />
        {showLegend && <Legend />}
        {cfg.yCols.map((c, i) => (
          <Area
            key={c}
            type="monotone"
            dataKey={c}
            stroke={palette[i % palette.length]}
            fill={palette[i % palette.length]}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    );
  }

  // bar (default)
  return (
    <BarChart data={data} margin={margin}>
      <CartesianGrid stroke={gridColor} vertical={false} />
      <XAxis dataKey={cfg.xCol} tick={tick} stroke={axisColor} />
      <YAxis tick={tick} stroke={axisColor} width={44} />
      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridColor, fillOpacity: 0.25 }} />
      {showLegend && <Legend />}
      {cfg.yCols.map((c, i) => (
        <Bar key={c} dataKey={c} fill={palette[i % palette.length]} radius={[4, 4, 0, 0]} />
      ))}
    </BarChart>
  );
}

/** Columns whose non-null values are all numbers (candidate Y series).
 *  Scans a sample: column types are homogeneous in practice, and a full scan of
 *  a 50k-row result on every config change is wasted work. */
function numericColumns(result: QueryResult): string[] {
  const { columns, rows } = result;
  const limit = Math.min(rows.length, NUMERIC_SCAN_ROWS);
  return columns.filter((_, j) => {
    let sawNumber = false;
    for (let r = 0; r < limit; r++) {
      const v = rows[r][j];
      if (v === null) continue;
      if (typeof v === "number") {
        sawNumber = true;
        continue;
      }
      return false;
    }
    return sawNumber;
  });
}

/** Resolve the effective chart config: fall back to a sensible auto default and
 *  drop columns that no longer exist (e.g. after the query changed). */
function sanitizeConfig(
  config: ChartConfig | undefined,
  result: QueryResult,
  numericCols: string[],
): ChartConfig {
  const cols = result.columns;
  const pickY = (xCol: string): string[] => {
    const pool = (numericCols.length ? numericCols : cols).filter((c) => c !== xCol);
    return pool.length ? [pool[0]] : cols.length ? [cols[0]] : [];
  };
  if (config) {
    const xCol = cols.includes(config.xCol) ? config.xCol : cols[0] ?? "";
    const yCols = config.yCols.filter((c) => cols.includes(c));
    return { type: config.type, xCol, yCols: yCols.length ? yCols : pickY(xCol) };
  }
  const xCol = cols[0] ?? "";
  return { type: "bar", xCol, yCols: pickY(xCol) };
}

/** Read the 8-slot categorical chart palette from CSS tokens (theme-aware). */
function readPalette(): string[] {
  const fallback = [
    "#3987e5", "#d95926", "#199e70", "#c98500",
    "#d55181", "#008300", "#9085e9", "#e66767",
  ];
  if (typeof window === "undefined") return fallback;
  const s = getComputedStyle(document.documentElement);
  const out: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = s.getPropertyValue(`--chart-${i}`).trim();
    if (v) out.push(v);
  }
  return out.length ? out : fallback;
}

/** Read a single CSS custom property off :root, with a fallback. */
function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// ============================================================================
// Shared helpers
// ============================================================================
/** Map one positional row into a `{ column: value }` object. */
function rowToObject(row: Cell[], columns: string[]): Record<string, Cell> {
  const o: Record<string, Cell> = {};
  for (let i = 0; i < columns.length; i++) o[columns[i]] = row[i];
  return o;
}

/** Rebuild a nested group into a plain JSON object: parent fields + a child
 *  array under the detected label. Column order is preserved. Called only for
 *  the groups currently on screen. */
function groupToObject(
  g: NestedGroup,
  shape: NestedShape,
  columns: string[],
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const i of shape.parentIndexes) o[columns[i]] = g.parent[i];
  o[shape.childLabel] = g.children.map((row) => {
    const c: Record<string, Cell> = {};
    for (const i of shape.childIndexes) c[columns[i]] = row[i];
    return c;
  });
  return o;
}

// ============================================================================
// Cell / row context-menu actions (table view)
// ============================================================================
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
