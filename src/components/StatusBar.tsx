import { useGraftStore } from "../store/useGraftStore";
import { basename } from "../paths";

/** Bottom status bar (wireframe screens 02/03). */
export function StatusBar() {
  const dbPath = useGraftStore((s) => s.dbPath);
  const nodes = useGraftStore((s) => s.nodes);
  // Group containers are not blocks; count SQL + linked result blocks only.
  const blockCount = nodes.filter((n) => n.type !== "group").length;
  const resultCount = nodes.filter((n) => n.type !== "group" && n.data.result).length;

  return (
    <footer className="statusbar">
      <span className={dbPath ? "dot-green" : "dot-gray"} />
      <span>
        {dbPath ? `connected · ${basename(dbPath)} · SQLite` : "no database connected"}
      </span>
      <span style={{ flex: 1 }} />
      <span>
        {blockCount} block{blockCount === 1 ? "" : "s"} · {resultCount} result
        {resultCount === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
