import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppCommands } from "./commands";

/** Event emitted by the backend when a native menu item is clicked
 *  (`src-tauri/src/menu.rs`); its payload is a command id. */
const MENU_EVENT = "menu-action";

/** Run the app command matching each native menu click. */
export function useMenuActions() {
  const commands = useAppCommands();

  useEffect(() => {
    const unlisten = listen<string>(MENU_EVENT, (event) => {
      const command = commands.find((c) => c.id === event.payload);
      if (command?.isEnabled()) command.run();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [commands]);
}
