import type { QueryResult } from "../types";

/** Renders a query result set as a compact scrollable table with row numbers. */
export function ResultTable({ result }: { result: QueryResult }) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th className="result-table__rownum">#</th>
          {result.columns.map((col) => (
            <th key={col}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            <td className="result-table__rownum">{i + 1}</td>
            {row.map((cell, j) => {
              if (cell === null) {
                return (
                  <td key={j} className="is-null">
                    <em>null</em>
                  </td>
                );
              }
              const isNumber = typeof cell === "number";
              const text = String(cell);
              return (
                <td
                  key={j}
                  className={isNumber ? "is-number" : undefined}
                  title={text}
                  onDoubleClick={() => {
                    // Quality-of-life: copy cell value on double-click.
                    void navigator.clipboard?.writeText(text);
                  }}
                >
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
