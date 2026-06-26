import { Panel } from "@xyflow/react";
import { useGraftStore } from "../store/useGraftStore";
import type { BlockType } from "../types";

const BLOCK_TYPES: BlockType[] = [
  "query",
  "migration",
  "procedure",
  "trigger",
  "view",
  "script",
];

/** Top toolbar: DB connection status, add-block menu, and save/load. */
export function Toolbar() {
  const dbPath = useGraftStore((s) => s.dbPath);
  const addBlock = useGraftStore((s) => s.addBlock);
  const connectDatabase = useGraftStore((s) => s.connectDatabase);
  const saveNotebook = useGraftStore((s) => s.saveNotebook);
  const loadNotebook = useGraftStore((s) => s.loadNotebook);

  return (
    <Panel position="top-left" className="toolbar">
      <strong className="toolbar__brand">Graft</strong>

      <button onClick={connectDatabase}>
        {dbPath ? `● ${dbPath.split("/").pop()}` : "Connect SQLite…"}
      </button>

      <span className="toolbar__sep" />

      <span className="toolbar__label">Add block:</span>
      {BLOCK_TYPES.map((t) => (
        <button key={t} onClick={() => addBlock(t)}>
          {t}
        </button>
      ))}

      <span className="toolbar__sep" />

      <button onClick={saveNotebook}>Save</button>
      <button onClick={loadNotebook}>Open</button>
    </Panel>
  );
}
