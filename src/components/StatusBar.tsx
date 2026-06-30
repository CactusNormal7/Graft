import { useGraftStore } from "../store/useGraftStore";

/** Bottom status bar (wireframe screens 02/03). */
export function StatusBar() {
  const dbPath = useGraftStore((s) => s.dbPath);
  const nodes = useGraftStore((s) => s.nodes);
  const resultCount = nodes.filter((n) => n.data.result).length;

  return (
    <footer className="statusbar">
      <span className={dbPath ? "dot-green" : "dot-gray"} />
      <span>
        {dbPath ? `connected · ${dbPath.split("/").pop()} · SQLite` : "no database connected"}
      </span>
      <span style={{ flex: 1 }} />
      <span>
        {nodes.length} block{nodes.length === 1 ? "" : "s"} · {resultCount} result
        {resultCount === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
