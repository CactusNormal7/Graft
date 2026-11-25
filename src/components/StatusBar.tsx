import { useGraftStore } from "../store/useGraftStore";
import { ENGINE_LABEL, connectionLabel } from "../connection";

/** Bottom status bar (wireframe screens 02/03). */
export function StatusBar() {
  const connection = useGraftStore((s) => s.connection);
  const schemaError = useGraftStore((s) => s.schemaError);
  const isConnected = connection !== null && schemaError === null;
  const nodes = useGraftStore((s) => s.nodes);
  // Groups and table nodes are not blocks; count SQL + linked result blocks.
  const blocks = nodes.filter((n) => n.type === "sqlBlock" || n.type === "resultBlock");
  const blockCount = blocks.length;
  const resultCount = blocks.filter((n) => n.data.result).length;

  return (
    <footer className="statusbar">
      <span className={isConnected ? "dot-green" : "dot-gray"} />
      <span>
        {connection
          ? `${isConnected ? "connected" : "unreachable"} · ${connectionLabel(connection)} · ${ENGINE_LABEL[connection.engine]}`
          : "no database connected"}
      </span>
      <span style={{ flex: 1 }} />
      <span>
        {blockCount} block{blockCount === 1 ? "" : "s"} · {resultCount} result
        {resultCount === 1 ? "" : "s"}
      </span>
    </footer>
  );
}
