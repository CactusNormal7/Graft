/**
 * Application commands, defined once and surfaced by the ⌘K palette (and the
 * native menu bar). Built in a hook because the canvas zoom lives in React
 * Flow's context, not in the store.
 */
import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraftStore } from "./store/useGraftStore";
import { askConfirm, showError, showMessage } from "./dialogs/appDialogs";
import { invoke } from "@tauri-apps/api/core";
import type { BlockType } from "./types";

export interface AppCommand {
  id: string;
  label: string;
  /** Accelerator in `Mod+Shift+F` form (see `shortcutLabel`). */
  shortcut?: string;
  isEnabled: () => boolean;
  run: () => void;
}

export const BLOCK_TYPES: BlockType[] = [
  "query",
  "migration",
  "procedure",
  "trigger",
  "view",
  "script",
];

/** Accelerators shared by the editor keymap, the palette and the menu. */
export const SHORTCUTS = {
  formatSql: "Shift+Alt+F",
  runBlock: "Mod+Enter",
  save: "Mod+S",
  palette: "Mod+K",
  newProject: "Mod+N",
  openProject: "Mod+O",
  runAll: "Mod+Shift+Enter",
  home: "Mod+Shift+H",
  zoomIn: "Mod+=",
  zoomOut: "Mod+-",
  fitView: "Mod+0",
} as const;

const FIT_VIEW_DURATION_MS = 200;
const always = () => true;
const isCanvasShown = () => useGraftStore.getState().view === "canvas";
const hasFocusedBlock = () => isCanvasShown() && useGraftStore.getState().focusedBlockId !== null;

/** Register the bundled graft-mcp server in Claude Desktop's configuration. */
async function installInClaudeDesktop() {
  const isConfirmed = await askConfirm({
    title: "Install in Claude Desktop",
    message:
      "Adds Graft's MCP server to Claude Desktop's configuration (your other settings are kept, " +
      "and the previous file is backed up). Claude will see the projects you open in Graft, " +
      "read-only unless you allow writes per project in the Connection dialog.",
    okLabel: "Install",
    isDanger: false,
  });
  if (!isConfirmed) return;
  try {
    const configPath = await invoke<string>("install_claude_desktop");
    await showMessage({
      title: "Installed",
      message: `Written to ${configPath}.\n\nRestart Claude Desktop to use Graft.`,
      tone: "info",
    });
  } catch (err) {
    await showError("Could not install in Claude Desktop", String(err));
  }
}

export function useAppCommands(): AppCommand[] {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return useMemo(() => {
    const store = () => useGraftStore.getState();
    const newBlockCommands: AppCommand[] = BLOCK_TYPES.map((type) => ({
      id: `block.new.${type}`,
      label: `New ${type} block`,
      isEnabled: isCanvasShown,
      run: () => store().addBlock(type),
    }));
    // Canvas-only commands are disabled on the home screen (no project shown).
    return [
      {
        id: "project.new",
        label: "New project…",
        shortcut: SHORTCUTS.newProject,
        isEnabled: always,
        run: () => {
          store().goHome();
          store().setNewProjectModalOpen(true);
        },
      },
      {
        id: "project.open",
        label: "Open project…",
        shortcut: SHORTCUTS.openProject,
        isEnabled: always,
        run: () => void store().openProjectFromDialog(),
      },
      {
        id: "view.palette",
        label: "Command palette",
        shortcut: SHORTCUTS.palette,
        isEnabled: isCanvasShown,
        run: () => store().setPaletteOpen(true),
      },
      {
        id: "sql.format",
        label: "Format SQL",
        shortcut: SHORTCUTS.formatSql,
        isEnabled: hasFocusedBlock,
        run: () => store().formatFocusedBlock(),
      },
      {
        id: "block.run",
        label: "Run focused block",
        shortcut: SHORTCUTS.runBlock,
        isEnabled: hasFocusedBlock,
        run: () => {
          const focused = store().focusedBlockId;
          if (focused) void store().runBlock(focused);
        },
      },
      {
        id: "block.runAll",
        label: "Run all blocks",
        shortcut: SHORTCUTS.runAll,
        isEnabled: isCanvasShown,
        run: () => void store().runAll(),
      },
      ...newBlockCommands,
      {
        id: "canvas.addReferencedTables",
        label: "Add referenced tables to canvas",
        isEnabled: isCanvasShown,
        run: () => {
          if (store().addReferencedTables() === 0) {
            void showMessage({
              title: "No table to add",
              message: "Every table referenced by the blocks of this page is already on the canvas (or none is referenced).",
              tone: "info",
            });
          }
        },
      },
      { id: "group.new", label: "New group", isEnabled: isCanvasShown, run: () => store().addGroup() },
      { id: "page.new", label: "New page", isEnabled: isCanvasShown, run: () => store().addPage() },
      {
        id: "project.save",
        label: "Save project",
        shortcut: SHORTCUTS.save,
        isEnabled: isCanvasShown,
        run: () => void store().saveNotebook(),
      },
      {
        id: "data.import",
        label: "Import data file…",
        isEnabled: isCanvasShown,
        run: () => void store().importDataFile(),
      },
      {
        id: "schema.refresh",
        label: "Refresh schema",
        isEnabled: isCanvasShown,
        run: () => void store().refreshSchema(),
      },
      {
        id: "view.zoomIn",
        label: "Zoom in",
        shortcut: SHORTCUTS.zoomIn,
        isEnabled: isCanvasShown,
        run: () => void zoomIn(),
      },
      {
        id: "view.zoomOut",
        label: "Zoom out",
        shortcut: SHORTCUTS.zoomOut,
        isEnabled: isCanvasShown,
        run: () => void zoomOut(),
      },
      {
        id: "view.fit",
        label: "Fit canvas to window",
        shortcut: SHORTCUTS.fitView,
        isEnabled: isCanvasShown,
        run: () => void fitView({ duration: FIT_VIEW_DURATION_MS }),
      },
      {
        id: "claude.install",
        label: "Install in Claude Desktop…",
        isEnabled: always,
        run: () => void installInClaudeDesktop(),
      },
      {
        id: "app.home",
        label: "Go to home screen",
        shortcut: SHORTCUTS.home,
        isEnabled: isCanvasShown,
        run: () => store().goHome(),
      },
    ];
  }, [zoomIn, zoomOut, fitView]);
}
