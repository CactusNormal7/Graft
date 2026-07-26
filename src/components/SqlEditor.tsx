import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
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
import { registerEditor, unregisterEditor } from "../canvas/editorRegistry";

interface SqlEditorProps {
  blockId: string;
  value: string;
  /** table/view → columns, for autocompletion. */
  schema: Record<string, string[]>;
  onChange: (value: string) => void;
  onRun: () => void;
  onFocus?: () => void;
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
}: SqlEditorProps) {
  // Keep callbacks current without rebuilding the editor extensions.
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;

  const cmRef = useRef<ReactCodeMirrorRef>(null);

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
          ".cm-tooltip-autocomplete ul li[aria-selected]": {
            backgroundColor: "var(--accent-dim)",
            color: "var(--accent)",
          },
        },
        { dark: true },
      ),
    ];
  }, [schema]);

  // Register the editor view in the module-level registry so external UI
  // (sidebar clicks) can dispatch edits into the currently focused block.
  useEffect(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    registerEditor(blockId, view);
    return () => unregisterEditor(blockId, view);
  }, [blockId]);

  return (
    <CodeMirror
      ref={cmRef}
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
    />
  );
}
