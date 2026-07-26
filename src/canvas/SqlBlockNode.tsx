import { useCallback, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useGraftStore, type SqlNode } from "../store/useGraftStore";
import { SqlEditor } from "../components/SqlEditor";
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

export function SqlBlockNode({ id, data, selected }: NodeProps<SqlNode>) {
  const updateSql = useGraftStore((s) => s.updateSql);
  const updateTitle = useGraftStore((s) => s.updateTitle);
  const runBlock = useGraftStore((s) => s.runBlock);
  const duplicateBlock = useGraftStore((s) => s.duplicateBlock);
  const deleteBlock = useGraftStore((s) => s.deleteBlock);
  const setResultView = useGraftStore((s) => s.setResultView);
  const setChartConfig = useGraftStore((s) => s.setChartConfig);
  const setEmitToBlock = useGraftStore((s) => s.setEmitToBlock);
  const resizeBlock = useGraftStore((s) => s.resizeBlock);
  const setFocusedBlock = useGraftStore((s) => s.setFocusedBlock);
  const toggleCollapse = useGraftStore((s) => s.toggleCollapse);
  const saveBlockAsSnippet = useGraftStore((s) => s.saveBlockAsSnippet);
  const generateInsertsAction = useGraftStore((s) => s.generateInserts);
  const copyInsertsAction = useGraftStore((s) => s.copyInserts);
  const exportInsertsAction = useGraftStore((s) => s.exportInserts);
  const schema = useGraftStore((s) => s.schema);

  // INSERT generation needs rows — either embedded or routed to a linked block.
  const hasResultRows =
    (data.result?.rows.length ?? 0) > 0 || data.linkedResultId != null;

  const collapsed = data.collapsed === true;
  const editorScrollRef = useInnerScroll<HTMLDivElement>(selected === true);
  const resultScrollRef = useInnerScroll<HTMLDivElement>(selected === true);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);

  const resultView: ResultView = normalizeResultView(data.resultView);
  const emitToBlock = data.emitToBlock === true;
  // If the result is routed to a linked block, don't render it embedded.
  const hasEmbeddedResult =
    !emitToBlock && data.status === "success" && data.result !== null;

  // Stable identity so the memoized <ResultTable> doesn't re-render on every
  // keystroke in the editor.
  const handleChartConfig = useCallback(
    (c: ChartConfig) => setChartConfig(id, c),
    [id, setChartConfig],
  );

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== data.title) updateTitle(id, next);
    else setTitleDraft(data.title);
    setEditingTitle(false);
  };

  const cycleView = () => {
    // table → json → chart → table
    const next: ResultView =
      resultView === "table" ? "json" : resultView === "json" ? "chart" : "table";
    setResultView(id, next);
  };

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const openViewMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setViewMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  const menuActions: MenuAction[] = [
    { label: "Run", shortcut: "Ctrl+↵", onClick: () => runBlock(id) },
    { label: "Duplicate", onClick: () => duplicateBlock(id) },
    { label: "Rename", onClick: () => setEditingTitle(true) },
    {
      label: collapsed ? "Expand block" : "Collapse block",
      onClick: () => toggleCollapse(id),
    },
    {
      label: "Save as favorite…",
      onClick: () => {
        const name = window.prompt(
          "Favorite name (used as {{name}} in other queries):",
          data.title,
        );
        if (name) saveBlockAsSnippet(id, name);
      },
    },
    {
      label: "Copy SQL",
      onClick: () => void navigator.clipboard?.writeText(data.sql),
    },
    { separator: true },
    { label: "View: table", onClick: () => setResultView(id, "table") },
    { label: "View: json", onClick: () => setResultView(id, "json") },
    { label: "View: chart", onClick: () => setResultView(id, "chart") },
    { separator: true },
    {
      label: emitToBlock
        ? "✓ Show result in linked block"
        : "Show result in linked block",
      onClick: () => setEmitToBlock(id, !emitToBlock),
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
    { label: "Bring to front", disabled: true },
    { separator: true },
    { label: "Delete", onClick: () => deleteBlock(id), danger: true },
  ];

  const viewMenuActions: MenuAction[] = [
    {
      label: resultView === "table" ? "✓ Table" : "Table",
      onClick: () => setResultView(id, "table"),
    },
    {
      label: resultView === "json" ? "✓ JSON (tree)" : "JSON (tree)",
      onClick: () => setResultView(id, "json"),
    },
    {
      label: resultView === "chart" ? "✓ Chart" : "Chart",
      onClick: () => setResultView(id, "chart"),
    },
  ];

  return (
    <div
      className={`sql-block ${selected ? "selected" : ""}${collapsed ? " is-collapsed" : ""}`}
      onContextMenu={openMenu}
    >
      {/* Controls stay invisible (CSS) — the resize cursor is the affordance.
          Disabled while collapsed so the block keeps its header height. */}
      <NodeResizer
        minWidth={320}
        minHeight={160}
        isVisible={!collapsed}
        lineClassName="sql-block__resize-line"
        handleClassName="sql-block__resize-handle"
        onResizeEnd={(_evt, params) => resizeBlock(id, params.width, params.height)}
      />

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <header className="card-header">
        <button
          className="btn sql-block__icon sql-block__collapse nodrag"
          title={collapsed ? "Expand block" : "Collapse to header"}
          onClick={() => toggleCollapse(id)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
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
          {data.result && !emitToBlock && (
            <button
              className={`btn sql-block__icon${resultView !== "table" ? " is-on" : ""}`}
              title={`Result view: ${resultView} (click to cycle, right-click for menu)`}
              onClick={cycleView}
              onContextMenu={openViewMenu}
            >
              {VIEW_ICON[resultView]}
            </button>
          )}
          <button
            className={`btn sql-block__icon${emitToBlock ? " is-on" : ""}`}
            title={
              emitToBlock
                ? "Result goes to linked block (toggle off)"
                : "Show result in a separate linked block"
            }
            onClick={() => setEmitToBlock(id, !emitToBlock)}
          >
            ⇥
          </button>
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

      {!collapsed && (
        <div className="sql-block__editor-wrap" ref={editorScrollRef}>
          <SqlEditor
            blockId={id}
            value={data.sql}
            schema={schema}
            onChange={(v) => updateSql(id, v)}
            onRun={() => runBlock(id)}
            onFocus={() => setFocusedBlock(id)}
          />
        </div>
      )}

      {!collapsed && data.status === "error" && data.error && !emitToBlock && (
        <pre className="sql-block__error">{data.error}</pre>
      )}

      {!collapsed && hasEmbeddedResult && data.result && (
        data.result.columns.length > 0 ? (
          <>
            <div
              className="sql-block__result"
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

      {!collapsed && emitToBlock && !data.linkedResultId && (
        <div className="sql-block__footer sql-block__footer--info">
          <span className="text-muted">
            Result will appear in a linked block · run to spawn it
          </span>
        </div>
      )}

      {menuPos && (
        <BlockContextMenu
          x={menuPos.x}
          y={menuPos.y}
          actions={menuActions}
          onClose={() => setMenuPos(null)}
        />
      )}
      {viewMenu && (
        <BlockContextMenu
          x={viewMenu.x}
          y={viewMenu.y}
          actions={viewMenuActions}
          onClose={() => setViewMenu(null)}
        />
      )}
    </div>
  );
}
