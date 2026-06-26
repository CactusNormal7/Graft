import { ReactFlowProvider } from "@xyflow/react";
import { GraftCanvas } from "./canvas/GraftCanvas";
import "./App.css";

function App() {
  return (
    <ReactFlowProvider>
      <GraftCanvas />
    </ReactFlowProvider>
  );
}

export default App;
