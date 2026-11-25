import { useEffect, useRef, useState } from "react";
import { useDialogStore, type DialogRequest } from "./appDialogs";

/** Renders the oldest pending in-app dialog (see `appDialogs.ts`). */
export function AppDialogHost() {
  const request = useDialogStore((s) => s.queue[0]);
  if (!request) return null;
  // Keyed so each request gets fresh local state (prompt draft, focus).
  return <AppDialog key={request.id} request={request} />;
}

function cancel(request: DialogRequest) {
  if (request.kind === "message") request.resolve();
  else if (request.kind === "confirm") request.resolve(false);
  else request.resolve(null);
}

function AppDialog({ request }: { request: DialogRequest }) {
  const [draft, setDraft] = useState(request.kind === "prompt" ? request.defaultValue : "");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      okRef.current?.focus();
    }
  }, []);

  const accept = () => {
    if (request.kind === "message") request.resolve();
    else if (request.kind === "confirm") request.resolve(true);
    else request.resolve(draft);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keep keys from reaching the canvas / global shortcuts underneath.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancel(request);
    } else if (e.key === "Enter" && request.kind === "prompt") {
      e.preventDefault();
      accept();
    }
  };

  const okLabel = request.kind === "message" ? "OK" : request.okLabel;
  const okClass =
    request.kind === "confirm" && request.isDanger ? "btn-danger" : "btn-accent";
  const isError = request.kind === "message" && request.tone === "error";

  return (
    <div className="modal-overlay" onMouseDown={() => cancel(request)}>
      <div
        className={`modal app-dialog${isError ? " app-dialog--error" : ""}`}
        role={request.kind === "message" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`app-dialog-${request.id}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal__title" id={`app-dialog-${request.id}`}>
          {request.title}
        </div>
        {request.message && <div className="app-dialog__message">{request.message}</div>}
        {request.kind === "prompt" && (
          <input
            ref={inputRef}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
        )}
        <div className="modal__actions">
          {request.kind !== "message" && (
            <button className="btn" onClick={() => cancel(request)}>
              Cancel
            </button>
          )}
          <button ref={okRef} className={okClass} onClick={accept}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
