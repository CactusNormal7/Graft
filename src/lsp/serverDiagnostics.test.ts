import { describe, expect, it, vi } from "vitest";
import {
  offsetOf,
  publishDiagnostics,
  subscribeDiagnostics,
  toServerDiagnostics,
} from "./serverDiagnostics";

const diagnostic = (line: number, start: number, end: number) => ({
  range: { start: { line, character: start }, end: { line, character: end } },
  message: "m",
});

describe("server diagnostics", () => {
  it("converts LSP positions to offsets, clamped to the text", () => {
    const text = "SELECT 1\nFROM t";
    expect(offsetOf(text, 1, 0)).toBe(9);
    expect(offsetOf(text, 1, 99)).toBe(text.length);
    expect(offsetOf(text, 7, 0)).toBe(text.length);
    expect(toServerDiagnostics(text, [diagnostic(1, 0, 4)])).toEqual([
      { from: 9, to: 13, message: "m" },
    ]);
  });

  it("delivers the latest diagnostics to subscribers of a document", () => {
    const listener = vi.fn();
    publishDiagnostics({ uri: "file:///a.sql", diagnostics: [diagnostic(0, 0, 1)] });
    const unsubscribe = subscribeDiagnostics("file:///a.sql", listener);
    expect(listener).toHaveBeenCalledTimes(1);

    publishDiagnostics({ uri: "file:///b.sql", diagnostics: [] });
    publishDiagnostics({ uri: "file:///a.sql", diagnostics: [] });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishDiagnostics({ uri: "file:///a.sql", diagnostics: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
