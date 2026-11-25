import { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  sql,
  SQLite,
  keywordCompletionSource,
  schemaCompletionSource,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  indentOnInput,
  foldKeymap,
} from "@codemirror/language";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { registerEditor, unregisterEditor } from "../canvas/editorRegistry";
import type { ErrorRange } from "./sqlDiagnostics";

interface SqlEditorProps {
  blockId: string;
  value: string;
  /** table/view → columns, for autocompletion. */
  schema: Record<string, string[]>;
  onChange: (value: string) => void;
  onRun: () => void;
  onFocus?: () => void;
  /** Last execution error, underlined in the editor when set. */
  error?: (ErrorRange & { message: string }) | null;
}

/** Diagnostics for the editor: none, or the execution error clamped to the
 *  document (the store clears the range on edit, but stay defensive). */
function toDiagnostics(
  error: SqlEditorProps["error"],
  docLength: number,
): Diagnostic[] {
  if (!error) return [];
  const from = Math.min(error.from, docLength);
  const to = Math.min(Math.max(error.to, from), docLength);
  return [{ from, to, severity: "error", message: error.message, source: "database" }];
}

/**
 * SQL editor for a block: CodeMirror 6 with SQLite dialect highlighting,
 * schema-aware autocompletion (tables/columns + keywords), line numbers,
 * bracket matching, and Cmd/Ctrl+Enter to run the block.
 */
export function SqlEditor({
  blockId,
  value,
  schema,
  onChange,
  onRun,
  onFocus,
  error,
}: SqlEditorProps) {
  // Keep callbacks current without rebuilding the editor extensions.
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;

  // The EditorView is created asynchronously by @uiw/react-codemirror (after a
  // re-render), so it can't be read from a ref in a mount effect — register it
  // from `onCreateEditor` instead.
  const viewRef = useRef<EditorView | null>(null);
  const errorRef = useRef(error);
  errorRef.current = error;

  const applyDiagnostics = useCallback((view: EditorView) => {
    const diagnostics = toDiagnostics(errorRef.current, view.state.doc.length);
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, []);

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      registerEditor(blockId, view);
      applyDiagnostics(view);
    },
    [blockId, applyDiagnostics],
  );

  useEffect(() => {
    if (viewRef.current) applyDiagnostics(viewRef.current);
  }, [error, applyDiagnostics]);

  const extensions = useMemo(() => {
    const dialect = SQLite;
    return [
      sql({
        dialect,
        schema: schema as SQLNamespace,
        upperCaseKeywords: true,
      }),
      // Explicit autocomplete config: open on typing (activateOnTyping),
      // and combine keyword + schema sources so tables/columns fire even
      // inside partially-typed identifiers.
      autocompletion({
        activateOnTyping: true,
        override: [
          schemaCompletionSource({
            dialect,
            schema: schema as SQLNamespace,
            upperCaseKeywords: true,
          }),
          keywordCompletionSource(dialect, true),
        ],
      }),
      closeBrackets(),
      bracketMatching(),
      indentOnInput(),
      // High precedence so Mod-Enter wins over the default editor bindings.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              runRef.current();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...foldKeymap,
        ]),
      ),
      EditorView.domEventHandlers({
        focus: () => {
          focusRef.current?.();
          return false;
        },
      }),
      EditorView.theme(
        {
          "&": {
            backgroundColor: "var(--editor-bg)",
            fontSize: "var(--mono-size)",
            // Fill the (flex) editor wrapper so the editor grows when the block
            // is resized taller; scroll internally past that.
            height: "100%",
          },
          ".cm-content": {
            fontFamily: "var(--font-mono)",
            minHeight: "84px",
            caretColor: "var(--accent)",
          },
          ".cm-scroller": {
            fontFamily: "var(--font-mono)",
            overflow: "auto",
          },
          ".cm-gutters": {
            backgroundColor: "var(--editor-bg)",
            color: "var(--muted-2)",
            border: "none",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "var(--panel-2)",
            color: "var(--text-2)",
          },
          ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.02)" },
          ".cm-matchingBracket, .cm-nonmatchingBracket": {
            backgroundColor: "var(--accent-dim)",
            outline: "1px solid var(--accent)",
          },
          ".cm-selectionBackground, ::selection": {
            backgroundColor: "var(--accent-dim)",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-tooltip": {
            backgroundColor: "var(--panel)",
            border: "1px solid var(--border-2)",
            borderRadius: "6px",
            boxShadow: "var(--shadow-float)",
            fontFamily: "var(--font-mono)",
          },
          ".cm-lintRange-error": {
            backgroundImage: "none",
            textDecoration: "underline wavy var(--error)",
            textDecorationSkipInk: "none",
            textUnderlineOffset: "3px",
          },
          ".cm-diagnostic-error": {
            borderLeft: "3px solid var(--error)",
            color: "var(--error-text)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
          },
          ".cm-tooltip-autocomplete ul li[aria-selected]": {
            backgroundColor: "var(--accent-dim)",
            color: "var(--accent)",
          },
        },
        { dark: true },
      ),
    ];
  }, [schema]);

  // Keep the module-level registry (used by the sidebar and the command
  // palette to insert into the focused block) free of destroyed views.
  useEffect(() => {
    // Re-register after a StrictMode remount (onCreateEditor won't fire again).
    if (viewRef.current) registerEditor(blockId, viewRef.current);
    return () => {
      if (viewRef.current) unregisterEditor(blockId, viewRef.current);
    };
  }, [blockId]);

  return (
    <CodeMirror
      className="nodrag sql-block__cm"
      value={value}
      theme="dark"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        highlightSelectionMatches: true,
        indentOnInput: false,
        // We provide our own autocompletion config above.
        autocompletion: false,
        bracketMatching: false,
        closeBrackets: false,
      }}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={handleCreateEditor}
    />
  );
}
