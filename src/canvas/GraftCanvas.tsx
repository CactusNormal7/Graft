import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { useGraftStore } from "../store/useGraftStore";
import { SqlBlockNode } from "./SqlBlockNode";
import { ResultBlockNode } from "./ResultBlockNode";

/** The infinite canvas hosting all SQL blocks (wireframe screens 02/03). */
export function GraftCanvas() {
  const nodes = useGraftStore((s) => s.nodes);
  const edges = useGraftStore((s) => s.edges);
  const onNodesChange = useGraftStore((s) => s.onNodesChange);
  const onEdgesChange = useGraftStore((s) => s.onEdgesChange);
  const onConnect = useGraftStore((s) => s.onConnect);
  const addBlock = useGraftStore((s) => s.addBlock);

  const nodeTypes = useMemo(
    () => ({ sqlBlock: SqlBlockNode, resultBlock: ResultBlockNode }),
    [],
  );

  return (
    <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2d3242" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#2d3242" maskColor="rgba(15,17,23,0.6)" />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">+</div>
          <div className="empty-state__title">No blocks yet.</div>
          <div className="text-muted">Add a block from the toolbar.</div>
          <button className="btn-accent" onClick={() => addBlock("query")}>
            + Add block
          </button>
        </div>
      )}
    </div>
  );
}
