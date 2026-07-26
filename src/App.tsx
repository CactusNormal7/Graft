import { ReactFlowProvider } from "@xyflow/react";
import { useGraftStore } from "./store/useGraftStore";
import { HomeScreen } from "./screens/HomeScreen";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { PageTabs } from "./components/PageTabs";
import { CommandPalette } from "./components/CommandPalette";
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
        <PageTabs />
        <StatusBar />
        <CommandPalette />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
