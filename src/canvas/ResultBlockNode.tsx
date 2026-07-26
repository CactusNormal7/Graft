import { useCallback, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type ResultNode } from "../store/useGraftStore";
import { ResultTable } from "./ResultTable";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import { useInnerScroll } from "./useInnerScroll";
import { normalizeResultView, type ChartConfig, type ResultView } from "../types";

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  running: "running…",
  success: "● success",
  error: "● error",
};

/** Glyph shown on the result-view toggle button, per active view. */
const VIEW_ICON: Record<ResultView, string> = {
  table: "☰",
  json: "{}",
  chart: "📊",
};

/**
 * Read-only companion node showing the last result of a source SQL block.
 * Spawned automatically when the source block has `emitToBlock` set.
 */
export function ResultBlockNode({ id, data, selected }: NodeProps<ResultNode>) {
  const deleteBlock = useGraftStore((s) => s.deleteBlock);
  const setResultView = useGraftStore((s) => s.setResultView);
  const setChartConfig = useGraftStore((s) => s.setChartConfig);
  const resizeBlock = useGraftStore((s) => s.resizeBlock);
  const runBlock = useGraftStore((s) => s.runBlock);
  const generateInsertsAction = useGraftStore((s) => s.generateInserts);
  const copyInsertsAction = useGraftStore((s) => s.copyInserts);
  const exportInsertsAction = useGraftStore((s) => s.exportInserts);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const resultView: ResultView = normalizeResultView(data.resultView);
  const resultScrollRef = useInnerScroll<HTMLDivElement>(selected === true);
  const hasResultRows = (data.result?.rows.length ?? 0) > 0;

  const cycleView = () => {
    // table → json → chart → table
    const next: ResultView =
      resultView === "table" ? "json" : resultView === "json" ? "chart" : "table";
    setResultView(id, next);
  };

  // Stable identity so the memoized <ResultTable> isn't invalidated on every
  // parent re-render.
  const handleChartConfig = useCallback(
    (c: ChartConfig) => setChartConfig(id, c),
    [id, setChartConfig],
  );

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const menuActions: MenuAction[] = [
    { label: "Re-run source", onClick: () => runBlock(data.sourceId) },
    { label: "View: table", onClick: () => setResultView(id, "table") },
    { label: "View: json", onClick: () => setResultView(id, "json") },
    { label: "View: chart", onClick: () => setResultView(id, "chart") },
    { separator: true },
    {
      label: "Copy result as JSON",
      onClick: () => {
        if (!data.result) return;
        const rows = data.result.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          data.result!.columns.forEach((c, i) => (obj[c] = row[i]));
          return obj;
        });
        void navigator.clipboard?.writeText(JSON.stringify(rows, null, 2));
      },
      disabled: !data.result || data.result.columns.length === 0,
    },
    { separator: true },
    {
      label: "Generate INSERTs → new block",
      onClick: () => generateInsertsAction(id),
      disabled: !hasResultRows,
    },
    {
      label: "Copy INSERTs",
      onClick: () => copyInsertsAction(id),
      disabled: !hasResultRows,
    },
    {
      label: "Export INSERTs (.sql)…",
      onClick: () => void exportInsertsAction(id),
      disabled: !hasResultRows,
    },
    { separator: true },
    { label: "Close (unlink)", onClick: () => deleteBlock(id), danger: true },
  ];

  return (
    <div
      className={`sql-block sql-block--result ${selected ? "selected" : ""}`}
      onContextMenu={openMenu}
    >
      <NodeResizer
        minWidth={320}
        minHeight={160}
        isVisible
        lineClassName="sql-block__resize-line"
        handleClassName="sql-block__resize-handle"
        onResizeEnd={(_evt, params) => resizeBlock(id, params.width, params.height)}
      />

      <Handle type="target" position={Position.Left} />

      <header className="card-header">
        <span className="badge badge--result">result</span>
        <span className="sql-block__title" title={`Linked to ${data.sourceTitle}`}>
          → {data.sourceTitle}
        </span>
        <span className={`sql-block__status sql-block__status--${data.status}`}>
          {STATUS_LABEL[data.status]}
        </span>

        <div className="sql-block__actions nodrag">
          {data.result && data.result.columns.length > 0 && (
            <button
              className={`btn sql-block__icon${resultView !== "table" ? " is-on" : ""}`}
              title={`Result view: ${resultView} (click to cycle)`}
              onClick={cycleView}
            >
              {VIEW_ICON[resultView]}
            </button>
          )}
          <button
            className="btn sql-block__icon"
            title="Re-run source block"
            onClick={() => runBlock(data.sourceId)}
          >
            ↻
          </button>
          <button
            className="btn sql-block__icon"
            title="Close (unlink from source)"
            onClick={() => deleteBlock(id)}
          >
            ✕
          </button>
        </div>
      </header>

      {data.status === "error" && data.error && (
        <pre className="sql-block__error">{data.error}</pre>
      )}

      {data.status === "idle" && !data.result && (
        <div className="sql-block__footer">
          <span className="text-muted">Waiting for source to run…</span>
        </div>
      )}

      {data.result && (
        data.result.columns.length > 0 ? (
          <>
            <div
              className="sql-block__result sql-block__result--flex"
              ref={resultScrollRef}
              style={data.height ? { maxHeight: "none" } : undefined}
            >
              <ResultTable
                result={data.result}
                view={resultView}
                chartConfig={data.chartConfig}
                onChartConfigChange={handleChartConfig}
              />
            </div>
            <div className="sql-block__footer sql-block__footer--success">
              {data.result.truncated ? (
                <span title={`Result capped at ${data.result.rows.length} rows`}>
                  {data.result.rows.length} / {data.result.total_rows} row(s)
                  <span className="text-muted"> · tronqué</span>
                </span>
              ) : (
                <span>{data.result.rows.length} row(s)</span>
              )}
              <span className="text-muted">· {data.result.elapsed_ms} ms</span>
            </div>
          </>
        ) : (
          <div className="sql-block__footer sql-block__footer--success">
            <span>{data.result.rows_affected} row(s) affected</span>
            <span className="text-muted">· {data.result.elapsed_ms} ms</span>
          </div>
        )
      )}

      {menuPos && (
        <BlockContextMenu
          x={menuPos.x}
          y={menuPos.y}
          actions={menuActions}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}
