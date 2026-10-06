import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useGraftStore } from "./store/useGraftStore";
import { HomeScreen } from "./screens/HomeScreen";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { PageTabs } from "./components/PageTabs";
import { CommandPalette } from "./components/CommandPalette";
import { GraftCanvas } from "./canvas/GraftCanvas";
import { onProjectFileChanged } from "./native";

function App() {
  const view = useGraftStore((s) => s.view);
  const saveNotebook = useGraftStore((s) => s.saveNotebook);

  // ⌘S / Ctrl+S saves the open project (also from inside a block editor).
  useEffect(() => {
    if (view !== "canvas") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNotebook();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, saveNotebook]);

  // Reload the open project when its file changes outside the app (e.g.
  // Claude editing blocks through graft-mcp). One listener for the app's life.
  useEffect(() => {
    const unlisten = onProjectFileChanged((path) => {
      const state = useGraftStore.getState();
      if (path === state.projectPath) void state.reloadFromDisk();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

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
