/**
 * Application commands, defined once and surfaced by the ⌘K palette (and the
 * native menu bar). Built in a hook because the canvas zoom lives in React
 * Flow's context, not in the store.
 */
import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { useGraftStore } from "./store/useGraftStore";
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
} as const;

const always = () => true;
const hasFocusedBlock = () => useGraftStore.getState().focusedBlockId !== null;

export function useAppCommands(): AppCommand[] {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return useMemo(() => {
    const store = () => useGraftStore.getState();
    const newBlockCommands: AppCommand[] = BLOCK_TYPES.map((type) => ({
      id: `block.new.${type}`,
      label: `New ${type} block`,
      isEnabled: always,
      run: () => store().addBlock(type),
    }));
    return [
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
        isEnabled: always,
        run: () => void store().runAll(),
      },
      ...newBlockCommands,
      { id: "group.new", label: "New group", isEnabled: always, run: () => store().addGroup() },
      { id: "page.new", label: "New page", isEnabled: always, run: () => store().addPage() },
      {
        id: "project.save",
        label: "Save project",
        shortcut: SHORTCUTS.save,
        isEnabled: always,
        run: () => void store().saveNotebook(),
      },
      {
        id: "data.import",
        label: "Import data file…",
        isEnabled: always,
        run: () => void store().importDataFile(),
      },
      {
        id: "schema.refresh",
        label: "Refresh schema",
        isEnabled: always,
        run: () => void store().refreshSchema(),
      },
      { id: "view.zoomIn", label: "Zoom in", isEnabled: always, run: () => void zoomIn() },
      { id: "view.zoomOut", label: "Zoom out", isEnabled: always, run: () => void zoomOut() },
      {
        id: "view.fit",
        label: "Fit canvas to window",
        isEnabled: always,
        run: () => void fitView({ duration: 200 }),
      },
      { id: "app.home", label: "Go to home screen", isEnabled: always, run: () => store().goHome() },
    ];
  }, [zoomIn, zoomOut, fitView]);
}
