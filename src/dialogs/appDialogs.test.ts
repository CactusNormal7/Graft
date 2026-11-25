import { beforeEach, describe, expect, it } from "vitest";
import { askConfirm, askText, showError, useDialogStore } from "./appDialogs";

const active = () => useDialogStore.getState().queue[0];

describe("app dialogs", () => {
  beforeEach(() => useDialogStore.setState({ queue: [] }));

  it("queues requests and resolves them in order", async () => {
    const first = showError("Save failed", "disk full");
    const second = askConfirm({ title: "Remove?", message: "x", okLabel: "Remove", isDanger: true });
    expect(useDialogStore.getState().queue).toHaveLength(2);
    expect(active()).toMatchObject({ kind: "message", tone: "error", message: "disk full" });

    const message = active();
    if (message.kind !== "message") throw new Error("expected a message");
    message.resolve();
    await first;

    const confirm = active();
    if (confirm.kind !== "confirm") throw new Error("expected a confirm");
    confirm.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });

  it("returns the entered text, or null when cancelled", async () => {
    const named = askText({ title: "Name", message: "", okLabel: "Save", defaultValue: "q" });
    const prompt = active();
    if (prompt.kind !== "prompt") throw new Error("expected a prompt");
    expect(prompt.defaultValue).toBe("q");
    prompt.resolve("orders");
    await expect(named).resolves.toBe("orders");

    const cancelled = askText({ title: "Name", message: "", okLabel: "Save", defaultValue: "" });
    const next = active();
    if (next.kind !== "prompt") throw new Error("expected a prompt");
    next.resolve(null);
    await expect(cancelled).resolves.toBeNull();
  });
});
