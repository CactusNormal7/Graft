import { useCallback, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type ResultNode } from "../store/useGraftStore";
import { ResultTable } from "./ResultTable";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import { useInnerScroll } from "./useInnerScroll";
import { ResultFooter, STATUS_LABEL, VIEW_ICON, nextResultView } from "./blockChrome";
import { rowToObject } from "./resultShape";
import { normalizeResultView, type ChartConfig, type ResultView } from "../types";

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

  const cycleView = () => setResultView(id, nextResultView(resultView));

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
        const result = data.result;
        if (!result) return;
        const rows = result.rows.map((row) => rowToObject(row, result.columns));
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
        <>
          {data.result.columns.length > 0 && (
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
          )}
          <ResultFooter result={data.result} />
        </>
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
