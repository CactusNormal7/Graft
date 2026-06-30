import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type SqlNode } from "../store/useGraftStore";
import { SqlEditor } from "../components/SqlEditor";
import { ResultTable } from "./ResultTable";

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  running: "running…",
  success: "● success",
  error: "● error",
};

/**
 * A single SQL block on the canvas: header (badge + title + status + run),
 * editable SQL (plain textarea for v0.1 — Monaco in v0.2), and inline footer
 * with results or errors. Styled from the Claude Design wireframe.
 */
export function SqlBlockNode({ id, data, selected }: NodeProps<SqlNode>) {
  const updateSql = useGraftStore((s) => s.updateSql);
  const runBlock = useGraftStore((s) => s.runBlock);
  const schema = useGraftStore((s) => s.schema);

  return (
    <div className={`sql-block ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <header className="card-header">
        <span className={`badge badge--${data.blockType}`}>{data.blockType}</span>
        <span className="sql-block__title">{data.title}</span>
        <span className={`sql-block__status sql-block__status--${data.status}`}>
          {STATUS_LABEL[data.status]}
        </span>
        <button
          className="btn-accent nodrag sql-block__run"
          disabled={data.status === "running"}
          onClick={() => runBlock(id)}
        >
          ▶
        </button>
      </header>

      <SqlEditor
        value={data.sql}
        schema={schema}
        onChange={(v) => updateSql(id, v)}
        onRun={() => runBlock(id)}
      />

      {data.status === "error" && data.error && (
        <pre className="sql-block__error">{data.error}</pre>
      )}

      {data.status === "success" && data.result && (
        data.result.columns.length > 0 ? (
          <>
            <div className="nowheel sql-block__result">
              <ResultTable result={data.result} />
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
    </div>
  );
}
