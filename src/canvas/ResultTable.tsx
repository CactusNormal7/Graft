import type { QueryResult } from "../types";

/** Renders a query result set as a compact scrollable table (wireframe style). */
export function ResultTable({ result }: { result: QueryResult }) {
  return (
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
            {row.map((cell, j) => {
              if (cell === null) {
                return (
                  <td key={j} className="is-null">
                    <em>null</em>
                  </td>
                );
              }
              const isNumber = typeof cell === "number";
              return (
                <td key={j} className={isNumber ? "is-number" : undefined}>
                  {String(cell)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
