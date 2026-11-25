/**
 * Diagnostics published by `sql-language-server`, kept per document and
 * converted to editor offsets. Pure apart from the listener registry, so the
 * conversion is unit-testable.
 */

/** Subset of an LSP `Diagnostic` this app reads. */
export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
}

/** A server diagnostic converted to editor offsets. */
export interface ServerDiagnostic {
  from: number;
  to: number;
  message: string;
}

type Listener = (diagnostics: LspDiagnostic[]) => void;

const latestByUri = new Map<string, LspDiagnostic[]>();
const listenersByUri = new Map<string, Set<Listener>>();

/** Offset of an LSP position (0-based line/character) in `text`, clamped. */
export function offsetOf(text: string, line: number, character: number): number {
  let lineStart = 0;
  for (let current = 0; current < line; current++) {
    const next = text.indexOf("\n", lineStart);
    if (next === -1) return text.length;
    lineStart = next + 1;
  }
  const lineEnd = text.indexOf("\n", lineStart);
  const lineLength = (lineEnd === -1 ? text.length : lineEnd) - lineStart;
  return lineStart + Math.min(character, lineLength);
}

export function toServerDiagnostics(
  text: string,
  diagnostics: LspDiagnostic[],
): ServerDiagnostic[] {
  return diagnostics.map(({ range, message }) => {
    const from = offsetOf(text, range.start.line, range.start.character);
    const to = Math.max(from, offsetOf(text, range.end.line, range.end.character));
    return { from, to, message };
  });
}

/** Handler for the server's `textDocument/publishDiagnostics` notification. */
export function publishDiagnostics(params: { uri: string; diagnostics: LspDiagnostic[] }) {
  latestByUri.set(params.uri, params.diagnostics);
  listenersByUri.get(params.uri)?.forEach((listener) => listener(params.diagnostics));
}

/** Follow the diagnostics of one document; returns the unsubscribe function. */
export function subscribeDiagnostics(uri: string, listener: Listener): () => void {
  const listeners = listenersByUri.get(uri) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByUri.set(uri, listeners);
  const latest = latestByUri.get(uri);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByUri.delete(uri);
      latestByUri.delete(uri);
    }
  };
}
