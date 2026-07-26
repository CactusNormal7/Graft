import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useGraftStore, type AnyNode } from "../store/useGraftStore";
import { SqlBlockNode } from "./SqlBlockNode";
import { ResultBlockNode } from "./ResultBlockNode";
import { GroupNode } from "./GroupNode";

/** The infinite canvas hosting all SQL blocks (wireframe screens 02/03). */
export function GraftCanvas() {
  const nodes = useGraftStore((s) => s.nodes);
  const edges = useGraftStore((s) => s.edges);
  const onNodesChange = useGraftStore((s) => s.onNodesChange);
  const onEdgesChange = useGraftStore((s) => s.onEdgesChange);
  const onConnect = useGraftStore((s) => s.onConnect);
  const addBlock = useGraftStore((s) => s.addBlock);
  const reparentNode = useGraftStore((s) => s.reparentNode);

  const { getIntersectingNodes, getInternalNode } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({ sqlBlock: SqlBlockNode, resultBlock: ResultBlockNode, group: GroupNode }),
    [],
  );

  // On drop, attach a block to the group it overlaps (or detach it), converting
  // the block's position between absolute and group-relative coordinates.
  const onNodeDragStop = useCallback(
    (_evt: MouseEvent | TouchEvent, node: AnyNode) => {
      if (node.type === "group") return; // moving a group already carries kids
      const overGroups = getIntersectingNodes(node).filter(
        (n) => n.type === "group",
      );
      const targetId = overGroups[0]?.id ?? null;
      const currentParent = node.parentId ?? null;
      if (targetId === currentParent) return;

      const nodeAbs =
        getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
      let position = { x: nodeAbs.x, y: nodeAbs.y };
      if (targetId) {
        const gAbs =
          getInternalNode(targetId)?.internals.positionAbsolute ?? { x: 0, y: 0 };
        position = { x: nodeAbs.x - gAbs.x, y: nodeAbs.y - gAbs.y };
      }
      reparentNode(node.id, targetId, position);
    },
    [getIntersectingNodes, getInternalNode, reparentNode],
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
        onNodeDragStop={onNodeDragStop}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        // Trackpad feel: two-finger scroll pans the canvas, pinch zooms.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        // Keep group containers behind blocks even when a group is selected.
        elevateNodesOnSelect={false}
        // Deletion goes through the ✕ buttons so cascades (linked results,
        // group children) run — keyboard delete would bypass them.
        deleteKeyCode={null}
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
