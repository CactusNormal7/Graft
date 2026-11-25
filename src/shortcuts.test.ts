import { describe, expect, it } from "vitest";
import { shortcutLabel } from "./shortcuts";

describe("shortcutLabel", () => {
  it("uses symbols on macOS and names elsewhere", () => {
    expect(shortcutLabel("Mod+Shift+F", true)).toBe("⌘⇧F");
    expect(shortcutLabel("Shift+Alt+F", true)).toBe("⇧⌥F");
    expect(shortcutLabel("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
    expect(shortcutLabel("Mod+Enter", false)).toBe("Ctrl+Enter");
  });
});
