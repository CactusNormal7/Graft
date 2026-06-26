import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type SqlNode } from "../store/useGraftStore";
import { ResultTable } from "./ResultTable";

/**
 * A single SQL block on the canvas: header, editable SQL (plain textarea for
 * v0.1 — Monaco lands in v0.2), a Run button, and inline results or errors.
 */
export function SqlBlockNode({ id, data, selected }: NodeProps<SqlNode>) {
  const updateSql = useGraftStore((s) => s.updateSql);
  const runBlock = useGraftStore((s) => s.runBlock);

  return (
    <div className={`sql-block ${selected ? "selected" : ""}`}>
      {/* Connection points for block ↔ block / block ↔ schema edges. */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <header className="sql-block__header">
        <span className={`badge badge--${data.blockType}`}>{data.blockType}</span>
        <span className="sql-block__title">{data.title}</span>
        <button
          className="nodrag run-btn"
          disabled={data.status === "running"}
          onClick={() => runBlock(id)}
        >
          {data.status === "running" ? "Running…" : "▶ Run"}
        </button>
      </header>

      <textarea
        className="nodrag nowheel sql-block__editor"
        value={data.sql}
        spellCheck={false}
        onChange={(e) => updateSql(id, e.currentTarget.value)}
      />

      {data.status === "error" && data.error && (
        <pre className="sql-block__error">{data.error}</pre>
      )}

      {data.status === "success" && data.result && (
        <div className="nowheel sql-block__result">
          {data.result.columns.length > 0 ? (
            <ResultTable result={data.result} />
          ) : (
            <p className="sql-block__meta">
              {data.result.rows_affected} row(s) affected · {data.result.elapsed_ms} ms
            </p>
          )}
        </div>
      )}
    </div>
  );
}
