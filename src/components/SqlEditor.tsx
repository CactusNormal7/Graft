import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLite, type SQLNamespace } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

interface SqlEditorProps {
  value: string;
  /** table/view → columns, for autocompletion. */
  schema: Record<string, string[]>;
  onChange: (value: string) => void;
  onRun: () => void;
}

/**
 * SQL editor for a block: CodeMirror 6 with SQLite dialect syntax highlighting,
 * schema-aware autocompletion (tables/columns + keywords), and Cmd/Ctrl+Enter to
 * run the block.
 */
export function SqlEditor({ value, schema, onChange, onRun }: SqlEditorProps) {
  // Keep onRun current without rebuilding the editor extensions on every render.
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const extensions = useMemo(
    () => [
      sql({
        dialect: SQLite,
        schema: schema as SQLNamespace,
        upperCaseKeywords: true,
      }),
      // High precedence so Mod-Enter wins over default editor bindings.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
      EditorView.theme(
        {
          "&": { backgroundColor: "var(--editor-bg)", fontSize: "var(--mono-size)" },
          ".cm-content": { fontFamily: "var(--font-mono)", minHeight: "84px" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", maxHeight: "240px" },
          ".cm-gutters": { display: "none" },
          "&.cm-focused": { outline: "none" },
        },
        { dark: true },
      ),
    ],
    [schema],
  );

  return (
    <CodeMirror
      className="nodrag nowheel sql-block__cm"
      value={value}
      theme="dark"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      extensions={extensions}
      onChange={onChange}
    />
  );
}
