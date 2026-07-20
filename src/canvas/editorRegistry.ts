import type { EditorView } from "@codemirror/view";

// A tiny registry keyed by block id, populated by each SqlEditor on mount so
// external UI (sidebar clicks, command palette, …) can dispatch edits into the
// currently focused block's CodeMirror view without threading refs through
// React Flow's node props.
const views = new Map<string, EditorView>();

export function registerEditor(id: string, view: EditorView) {
  views.set(id, view);
}

export function unregisterEditor(id: string, view: EditorView) {
  if (views.get(id) === view) views.delete(id);
}

/** Insert `text` at the caret of the block's editor, focus it, and place the
 *  caret right after the inserted text. No-op if the editor isn't mounted. */
export function insertIntoEditor(id: string, text: string) {
  const view = views.get(id);
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}
