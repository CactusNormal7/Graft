/**
 * Connection to `sql-language-server`, run by the backend (`src-tauri/src/lsp.rs`)
 * as a child process. Messages travel over Tauri IPC: `lsp_send` to the
 * server, `lsp-message` events back. One client is shared by every block
 * editor; each block is its own document (`blockDocumentUri`).
 *
 * The server is optional: when it is not installed `getLanguageServer()`
 * resolves to null and editors keep their built-in completion.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LSPClient, type Transport } from "@codemirror/lsp-client";
import { publishDiagnostics } from "./serverDiagnostics";

const MESSAGE_EVENT = "lsp-message";
const ROOT_URI = "file:///graft/";

/** sqlint's layout rules fight a free-form canvas editor and its keyword-case
 *  rule fires on every lowercase keyword: keep only the substantive ones. */
const LINT_RULES = {
  "align-column-to-the-first": "off",
  "align-where-clause-to-the-first": "off",
  "column-new-line": "off",
  "linebreak-after-clause-keyword": "off",
  "where-clause-new-line": "off",
  "reserved-word-case": "off",
  "space-surrounding-operators": "warning",
  "require-as-to-rename-column": "warning",
};

let clientPromise: Promise<LSPClient | null> | null = null;

export function blockDocumentUri(blockId: string): string {
  return `${ROOT_URI}${encodeURIComponent(blockId)}.sql`;
}

async function tauriTransport(): Promise<Transport> {
  const handlers = new Set<(message: string) => void>();
  await listen<string>(MESSAGE_EVENT, (event) => {
    handlers.forEach((handler) => handler(event.payload));
  });
  return {
    send: (message) => {
      invoke("lsp_send", { message }).catch((err) => console.error("lsp_send:", err));
    },
    subscribe: (handler) => handlers.add(handler),
    unsubscribe: (handler) => handlers.delete(handler),
  };
}

async function startLanguageServer(): Promise<LSPClient | null> {
  try {
    const isRunning = await invoke<boolean>("lsp_start");
    if (!isRunning) return null;
    const client = new LSPClient({
      rootUri: ROOT_URI,
      notificationHandlers: {
        "textDocument/publishDiagnostics": (_client, params) => {
          publishDiagnostics(params);
          return true;
        },
      },
    }).connect(await tauriTransport());
    await client.initializing;
    // No database connection is ever sent: the schema comes from Graft's own
    // introspection, and the server logs everything it receives.
    client.notification("workspace/didChangeConfiguration", {
      settings: { sqlLanguageServer: { lint: { rules: LINT_RULES } } },
    });
    return client;
  } catch (err) {
    console.error("sql-language-server unavailable:", err);
    return null;
  }
}

/** The shared client, started on first use; null when the server is absent. */
export function getLanguageServer(): Promise<LSPClient | null> {
  clientPromise ??= startLanguageServer();
  return clientPromise;
}
