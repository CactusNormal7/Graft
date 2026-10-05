import { useMemo } from "react";
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
import type { ChartConfig, ChartType, QueryResult } from "../types";
import { rowToObject, type Cell } from "./resultShape";

/** Max marks plotted in the chart view (readability + render cost). */
const CHART_MAX_POINTS = 500;
/** Rows sampled when inferring which columns are numeric. */
const NUMERIC_SCAN_ROWS = 200;

/** Chart result view — plot the result (bar / line / area / pie). */
export function ChartView({
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
            First {CHART_MAX_POINTS} of {result.rows.length} points
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
            Pick an X column and at least one Y series.
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
