import { useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type ResultNode } from "../store/useGraftStore";
import { ResultTable } from "./ResultTable";
import { BlockContextMenu, type MenuAction } from "./BlockContextMenu";
import type { ResultView } from "../types";

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  running: "running…",
  success: "● success",
  error: "● error",
};

/**
 * Read-only companion node showing the last result of a source SQL block.
 * Spawned automatically when the source block has `emitToBlock` set.
 */
export function ResultBlockNode({ id, data, selected }: NodeProps<ResultNode>) {
  const deleteBlock = useGraftStore((s) => s.deleteBlock);
  const setResultView = useGraftStore((s) => s.setResultView);
  const resizeBlock = useGraftStore((s) => s.resizeBlock);
  const runBlock = useGraftStore((s) => s.runBlock);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const resultView: ResultView = data.resultView ?? "table";

  const cycleView = () => {
    const next: ResultView =
      resultView === "table"
        ? "records"
        : resultView === "records"
        ? "nested"
        : "table";
    setResultView(id, next);
  };

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const menuActions: MenuAction[] = [
    { label: "Re-run source", onClick: () => runBlock(data.sourceId) },
    { label: "View: table", onClick: () => setResultView(id, "table") },
    { label: "View: records", onClick: () => setResultView(id, "records") },
    { label: "View: nested", onClick: () => setResultView(id, "nested") },
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
        isVisible={selected}
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
              {resultView === "table" ? "☰" : resultView === "records" ? "⊞" : "❯"}
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
              className="nowheel sql-block__result sql-block__result--flex"
              style={data.height ? { maxHeight: "none" } : undefined}
            >
              <ResultTable result={data.result} view={resultView} />
            </div>
            <div className="sql-block__footer sql-block__footer--success">
              <span>{data.result.rows.length} row(s)</span>
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
