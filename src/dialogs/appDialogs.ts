/**
 * In-app dialogs replacing the webview's `alert` / `confirm` / `prompt`, which
 * look foreign on macOS/Windows and block the UI thread. Callers (store or
 * components) await a promise; `<AppDialogHost>` renders the oldest pending
 * request. Requests queue up, so two errors in a row are both shown.
 */
import { create } from "zustand";

export type DialogTone = "info" | "error";

interface BaseRequest {
  id: number;
  title: string;
  message: string;
}

export type DialogRequest =
  | (BaseRequest & { kind: "message"; tone: DialogTone; resolve: () => void })
  | (BaseRequest & {
      kind: "confirm";
      okLabel: string;
      isDanger: boolean;
      resolve: (isConfirmed: boolean) => void;
    })
  | (BaseRequest & {
      kind: "prompt";
      okLabel: string;
      defaultValue: string;
      resolve: (value: string | null) => void;
    });

interface DialogState {
  queue: DialogRequest[];
}

export const useDialogStore = create<DialogState>(() => ({ queue: [] }));

let nextRequestId = 0;

type RequestFields<K extends DialogRequest["kind"]> = Omit<
  Extract<DialogRequest, { kind: K }>,
  "id" | "kind" | "resolve"
>;

function enqueue(request: DialogRequest) {
  useDialogStore.setState((state) => ({ queue: [...state.queue, request] }));
}

function dequeue(id: number) {
  useDialogStore.setState((state) => ({ queue: state.queue.filter((r) => r.id !== id) }));
}

/** Show a message with a single OK button; resolves when dismissed. */
export function showMessage(fields: RequestFields<"message">): Promise<void> {
  return new Promise((resolve) => {
    const id = nextRequestId++;
    enqueue({ ...fields, id, kind: "message", resolve: () => (dequeue(id), resolve()) });
  });
}

/** Shorthand for an error message, the most common case. */
export function showError(title: string, message: string): Promise<void> {
  return showMessage({ title, message, tone: "error" });
}

/** OK / Cancel; resolves to true when confirmed. */
export function askConfirm(fields: RequestFields<"confirm">): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextRequestId++;
    enqueue({
      ...fields,
      id,
      kind: "confirm",
      resolve: (isConfirmed) => (dequeue(id), resolve(isConfirmed)),
    });
  });
}

/** Text input; resolves to the entered text, or null when cancelled. */
export function askText(fields: RequestFields<"prompt">): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextRequestId++;
    enqueue({ ...fields, id, kind: "prompt", resolve: (value) => (dequeue(id), resolve(value)) });
  });
}
