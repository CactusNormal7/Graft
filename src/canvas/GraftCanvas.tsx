import { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";
import { useGraftStore } from "../store/useGraftStore";
import { SqlBlockNode } from "./SqlBlockNode";
import { Toolbar } from "./Toolbar";

/** The infinite canvas hosting all SQL blocks. */
export function GraftCanvas() {
  const nodes = useGraftStore((s) => s.nodes);
  const edges = useGraftStore((s) => s.edges);
  const onNodesChange = useGraftStore((s) => s.onNodesChange);
  const onEdgesChange = useGraftStore((s) => s.onEdgesChange);
  const onConnect = useGraftStore((s) => s.onConnect);

  const nodeTypes = useMemo(() => ({ sqlBlock: SqlBlockNode }), []);

  return (
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
      <Toolbar />
      <Background gap={20} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
