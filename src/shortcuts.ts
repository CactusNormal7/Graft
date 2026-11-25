/** Keyboard shortcut labels, written once as `Mod+Shift+F` and shown in each
 *  platform's convention (⌘⇧F on macOS, Ctrl+Shift+F on Windows). */

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Enter: "↵",
};
const PC_NAMES: Record<string, string> = { Mod: "Ctrl", Enter: "Enter" };

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Display label of an accelerator such as `Mod+Shift+F`. */
export function shortcutLabel(accelerator: string, isMac = isMacPlatform()): string {
  const keys = accelerator.split("+");
  return isMac
    ? keys.map((key) => MAC_SYMBOLS[key] ?? key).join("")
    : keys.map((key) => PC_NAMES[key] ?? key).join("+");
}
