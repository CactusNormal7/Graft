import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS, menuStates } from "./useMenuActions";
import type { AppCommand } from "./commands";

const command = (id: string, isEnabled: boolean): AppCommand => ({
  id,
  label: id,
  isEnabled: () => isEnabled,
  run: () => undefined,
});

describe("native menu sync", () => {
  it("maps each command to its enabled state", () => {
    expect(menuStates([command("project.save", false), command("project.new", true)])).toEqual({
      "project.save": false,
      "project.new": true,
    });
  });

  it("delays only the commands that read the editor", () => {
    expect(EDITOR_COMMANDS.has("block.run")).toBe(true);
    expect(EDITOR_COMMANDS.has("project.save")).toBe(false);
  });
});
