/** UI pieces shared by the SQL block and the linked result block, so both
 *  render status, view toggles and result footers identically. */
import type { ExecStatus, QueryResult, ResultView } from "../types";

export const STATUS_LABEL: Record<ExecStatus, string> = {
  idle: "idle",
  running: "running…",
  success: "● success",
  error: "● error",
};

/** Glyph shown on the result-view toggle button, per active view. */
export const VIEW_ICON: Record<ResultView, string> = {
  table: "☰",
  json: "{}",
  chart: "📊",
};

/** Next view in the toggle cycle: table → json → chart → table. */
export function nextResultView(view: ResultView): ResultView {
  return view === "table" ? "json" : view === "json" ? "chart" : "table";
}

/** Row count (with truncation notice) or affected rows, plus timing. */
export function ResultFooter({ result }: { result: QueryResult }) {
  const shown = result.rows.length;
  return (
    <div className="sql-block__footer sql-block__footer--success">
      {result.columns.length === 0 ? (
        <span>{result.rows_affected} row(s) affected</span>
      ) : result.truncated ? (
        <span title={`Result capped at ${shown} rows`}>
          {shown} / {result.total_rows} row(s)
          <span className="text-muted"> · truncated</span>
        </span>
      ) : (
        <span>{shown} row(s)</span>
      )}
      <span className="text-muted">· {result.elapsed_ms} ms</span>
    </div>
  );
}
