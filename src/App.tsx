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
import { AppDialogHost } from "./dialogs/AppDialogHost";
import { useMenuActions } from "./useMenuActions";

/** How often the open project file is checked for changes made by another
 *  program (a cheap modification-time read; the file is only re-read when
 *  that changes). */
const PROJECT_FILE_POLL_MS = 2000;

function Screens() {
  const view = useGraftStore((s) => s.view);
  const saveNotebook = useGraftStore((s) => s.saveNotebook);
  useMenuActions();

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
  return (
    <ReactFlowProvider>
      <Screens />
    </ReactFlowProvider>
  );
}

export default App;
