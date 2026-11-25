import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppCommands, type AppCommand } from "./commands";
import { useGraftStore } from "./store/useGraftStore";

/** Event emitted by the backend when a native menu item is clicked
 *  (`src-tauri/src/menu.rs`); its payload is a command id. */
const MENU_EVENT = "menu-action";

/**
 * Commands that read the focused editor's text. A menu accelerator is handled
 * by the OS before the webview, so keystrokes typed just before it may not be
 * in the editor yet: these commands wait a moment for them to land. A
 * mitigation, not a guarantee (see docs/technique.md § Barre de menus).
 */
export const EDITOR_COMMANDS = new Set(["block.run", "block.runAll", "sql.format"]);
export const EDITOR_SETTLE_MS = 60;

/** id → enabled, for the native menu's greyed-out state. */
export function menuStates(commands: AppCommand[]): Record<string, boolean> {
  return Object.fromEntries(commands.map((c) => [c.id, c.isEnabled()]));
}

/** Run the app command matching each native menu click, and keep the menu's
 *  enabled/disabled items in step with the app's context. */
export function useMenuActions() {
  const commands = useAppCommands();

  useEffect(() => {
    const unlisten = listen<string>(MENU_EVENT, (event) => {
      const command = commands.find((c) => c.id === event.payload);
      if (!command?.isEnabled()) return;
      if (EDITOR_COMMANDS.has(command.id)) setTimeout(() => command.run(), EDITOR_SETTLE_MS);
      else command.run();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [commands]);

  useEffect(() => {
    let lastSent = "";
    const sync = () => {
      const states = menuStates(commands);
      const serialized = JSON.stringify(states);
      if (serialized === lastSent) return;
      lastSent = serialized;
      invoke("set_menu_states", { states }).catch((err) =>
        console.error("set_menu_states:", err),
      );
    };
    sync();
    // Enabled states depend on the screen and on the focused block only.
    return useGraftStore.subscribe((state, prev) => {
      if (state.view !== prev.view || state.focusedBlockId !== prev.focusedBlockId) sync();
    });
  }, [commands]);
}
