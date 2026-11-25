import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  sql,
  MySQL,
  PostgreSQL,
  SQLite,
  keywordCompletionSource,
  schemaCompletionSource,
  type SQLDialect,
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
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { LSPClient, LSPPlugin, serverCompletionSource } from "@codemirror/lsp-client";
import { blockDocumentUri, getLanguageServer } from "../lsp/languageServer";
import {
  subscribeDiagnostics,
  toServerDiagnostics,
  type LspDiagnostic,
} from "../lsp/serverDiagnostics";
import { registerEditor, unregisterEditor } from "../canvas/editorRegistry";
import type { ErrorRange } from "./sqlDiagnostics";
import type { DbType } from "../types";

const DIALECT_BY_ENGINE: Record<DbType, SQLDialect> = {
  sqlite: SQLite,
  postgres: PostgreSQL,
  mysql: MySQL,
};

interface SqlEditorProps {
  blockId: string;
  value: string;
  /** table/view → columns, for autocompletion. */
  schema: Record<string, string[]>;
  /** Engine of the connection: picks the highlighting/completion dialect. */
  engine: DbType;
  onChange: (value: string) => void;
  onRun: () => void;
  /** Pretty-print the SQL (Shift+Alt+F). */
  onFormat?: () => void;
  onFocus?: () => void;
  /** Last execution error, underlined in the editor when set. */
  error?: (ErrorRange & { message: string }) | null;
}

/** Editor diagnostics: the execution error (clamped to the document — the
 *  store clears it on edit, but stay defensive) plus the language server's.
 *  Server diagnostics are only "info": its parser covers a subset of SQL and
 *  flags valid PRAGMA / CREATE TRIGGER / procedures; the engine is the judge. */
function toDiagnostics(
  error: SqlEditorProps["error"],
  serverDiagnostics: LspDiagnostic[],
  text: string,
): Diagnostic[] {
  const fromServer: Diagnostic[] = toServerDiagnostics(text, serverDiagnostics).map(
    (d) => ({ ...d, severity: "info", source: "sql-language-server" }),
  );
  if (!error) return fromServer;
  const from = Math.min(error.from, text.length);
  const to = Math.min(Math.max(error.to, from), text.length);
  return [
    { from, to, severity: "error", message: error.message, source: "database" },
    ...fromServer,
  ];
}

/**
 * SQL editor for a block: CodeMirror 6 with the connection's dialect
 * (SQLite / PostgreSQL / MySQL) for highlighting,
 * schema-aware autocompletion (tables/columns + keywords), line numbers,
 * bracket matching, and Cmd/Ctrl+Enter to run the block.
 */
export function SqlEditor({
  blockId,
  value,
  schema,
  engine,
  onChange,
  onRun,
  onFormat,
  onFocus,
  error,
}: SqlEditorProps) {
  // Keep callbacks current without rebuilding the editor extensions.
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const formatRef = useRef(onFormat);
  formatRef.current = onFormat;

  // The EditorView is created asynchronously by @uiw/react-codemirror (after a
  // re-render), so it can't be read from a ref in a mount effect — register it
  // from `onCreateEditor` instead.
  const viewRef = useRef<EditorView | null>(null);
  const errorRef = useRef(error);
  errorRef.current = error;
  const serverDiagnosticsRef = useRef<LspDiagnostic[]>([]);

  const [languageServer, setLanguageServer] = useState<LSPClient | null>(null);
  useEffect(() => {
    let isMounted = true;
    void getLanguageServer().then((client) => {
      if (isMounted) setLanguageServer(client);
    });
    return () => {
      isMounted = false;
    };
  }, []);
  const documentUri = blockDocumentUri(blockId);

  const applyDiagnostics = useCallback((view: EditorView) => {
    const diagnostics = toDiagnostics(
      errorRef.current,
      serverDiagnosticsRef.current,
      view.state.doc.toString(),
    );
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, []);

  useEffect(() => {
    if (!languageServer) return;
    return subscribeDiagnostics(documentUri, (diagnostics) => {
      serverDiagnosticsRef.current = diagnostics;
      if (viewRef.current) applyDiagnostics(viewRef.current);
    });
  }, [languageServer, documentUri, applyDiagnostics]);

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
    const dialect = DIALECT_BY_ENGINE[engine];
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
          ...(languageServer ? [serverCompletionSource] : []),
        ],
      }),
      // Declared up front (no lint source): diagnostics are pushed with
      // setDiagnostics, and the extension it would otherwise append on the fly
      // is dropped — with the underline — whenever these extensions change.
      linter(null),
      // Document sync only: completions are merged into the sources above, and
      // the package's bundled keymaps would steal Shift+Alt+F for LSP formatting.
      ...(languageServer ? [LSPPlugin.create(languageServer, documentUri, "sql")] : []),
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
          {
            key: "Shift-Alt-f",
            run: () => {
              formatRef.current?.();
              return formatRef.current !== undefined;
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
  }, [schema, engine, languageServer, documentUri]);

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
