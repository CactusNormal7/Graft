import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import { useGraftStore } from "./store/useGraftStore";
import { HomeScreen } from "./screens/HomeScreen";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { PageTabs } from "./components/PageTabs";
import { CommandPalette } from "./components/CommandPalette";
import { GraftCanvas } from "./canvas/GraftCanvas";
import { AppDialogHost } from "./dialogs/AppDialogHost";
import { useMenuActions } from "./useMenuActions";

/** How often the open project file is checked for changes made by another
 *  program (a cheap modification-time read; the file is only re-read when
 *  that changes). */
const PROJECT_FILE_POLL_MS = 2000;
/** Emitted by the backend when graft-mcp reports a change (src-tauri/src/bridge_server.rs). */
const BRIDGE_PROJECT_CHANGED_EVENT = "bridge-project-changed";

function Screens() {
  const view = useGraftStore((s) => s.view);
  const saveNotebook = useGraftStore((s) => s.saveNotebook);
  useMenuActions();

  // Live bridge: graft-mcp reports a project file it just wrote.
  useEffect(() => {
    const unlisten = listen<string>(BRIDGE_PROJECT_CHANGED_EVENT, (event) =>
      useGraftStore.getState().notifyProjectChanged(event.payload),
    );
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (view !== "canvas") return;
    const timer = setInterval(
      () => void useGraftStore.getState().checkProjectFile(),
      PROJECT_FILE_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [view]);

  // ⌘S / Ctrl+S saves the open project (also from inside a block editor).
  // The native File ▸ Save accelerator usually consumes the key first; saving
  // twice is harmless if both fire.
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

  if (view === "home") {
    return (
      <>
        <HomeScreen />
        <AppDialogHost />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar />
      <div className="app-body">
        <Sidebar />
        <GraftCanvas />
      </div>
      <PageTabs />
      <StatusBar />
      <CommandPalette />
      <AppDialogHost />
    </div>
  );
}

/** The provider wraps both screens so menu commands (zoom…) resolve the same
 *  way whichever screen is shown. */
function App() {
  useEffect(() => {
    void useGraftStore.getState().loadSavedConnections();
  }, []);

  return (
    <ReactFlowProvider>
      <Screens />
    </ReactFlowProvider>
  );
}

export default App;
