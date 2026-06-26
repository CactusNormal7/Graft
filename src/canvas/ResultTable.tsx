import type { QueryResult } from "../types";

/** Renders a query result set as a compact scrollable table. */
export function ResultTable({ result }: { result: QueryResult }) {
  return (
    <>
      <table className="result-table">
        <thead>
          <tr>
            {result.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell === null ? <em>null</em> : String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sql-block__meta">
        {result.rows.length} row(s) · {result.elapsed_ms} ms
      </p>
    </>
  );
}
