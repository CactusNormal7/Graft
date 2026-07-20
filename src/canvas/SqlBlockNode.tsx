import { useState } from "react";
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
 * A single SQL block on the canvas: header (badge + editable title + status +
 * actions), CodeMirror SQL editor, and inline footer with results or errors.
 */
export function SqlBlockNode({ id, data, selected }: NodeProps<SqlNode>) {
  const updateSql = useGraftStore((s) => s.updateSql);
  const updateTitle = useGraftStore((s) => s.updateTitle);
  const runBlock = useGraftStore((s) => s.runBlock);
  const duplicateBlock = useGraftStore((s) => s.duplicateBlock);
  const deleteBlock = useGraftStore((s) => s.deleteBlock);
  const setFocusedBlock = useGraftStore((s) => s.setFocusedBlock);
  const schema = useGraftStore((s) => s.schema);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== data.title) updateTitle(id, next);
    else setTitleDraft(data.title);
    setEditingTitle(false);
  };

  return (
    <div className={`sql-block ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <header className="card-header">
        <span className={`badge badge--${data.blockType}`}>{data.blockType}</span>

        {editingTitle ? (
          <input
            autoFocus
            className="sql-block__title-input nodrag"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(data.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <span
            className="sql-block__title"
            title="Double-click to rename"
            onDoubleClick={() => {
              setTitleDraft(data.title);
              setEditingTitle(true);
            }}
          >
            {data.title}
          </span>
        )}

        <span className={`sql-block__status sql-block__status--${data.status}`}>
          {STATUS_LABEL[data.status]}
        </span>

        <div className="sql-block__actions nodrag">
          <button
            className="btn sql-block__icon"
            title="Duplicate block"
            onClick={() => duplicateBlock(id)}
          >
            ⧉
          </button>
          <button
            className="btn sql-block__icon"
            title="Delete block"
            onClick={() => deleteBlock(id)}
          >
            ✕
          </button>
          <button
            className="btn-accent sql-block__run"
            disabled={data.status === "running"}
            title="Run (Ctrl/Cmd+Enter)"
            onClick={() => runBlock(id)}
          >
            ▶
          </button>
        </div>
      </header>

      <SqlEditor
        blockId={id}
        value={data.sql}
        schema={schema}
        onChange={(v) => updateSql(id, v)}
        onRun={() => runBlock(id)}
        onFocus={() => setFocusedBlock(id)}
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
