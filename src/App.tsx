import { ReactFlowProvider } from "@xyflow/react";
import { useGraftStore } from "./store/useGraftStore";
import { HomeScreen } from "./screens/HomeScreen";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { GraftCanvas } from "./canvas/GraftCanvas";

function App() {
  const view = useGraftStore((s) => s.view);

  if (view === "home") {
    return <HomeScreen />;
  }

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <Toolbar />
        <div className="app-body">
          <Sidebar />
          <GraftCanvas />
        </div>
        <StatusBar />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
