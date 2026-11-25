import { useEffect, useMemo, useRef, useState } from "react";
import { useGraftStore } from "../store/useGraftStore";
import { useAppCommands, type AppCommand } from "../commands";
import { shortcutLabel } from "../shortcuts";
import type { Snippet } from "../types";

type PaletteItem =
  | { kind: "command"; command: AppCommand }
  | { kind: "favorite"; snippet: Snippet };

const SQL_PREVIEW_LENGTH = 70;
/** Opening the palette from the palette makes no sense: not listed. */
const PALETTE_COMMAND_ID = "view.palette";

function matches(query: string, ...texts: string[]): boolean {
  return texts.some((text) => text.toLowerCase().includes(query));
}

/**
 * ⌘K / Ctrl+K action bar: app commands (format, run, new block, zoom…) and
 * saved favorite blocks. A favorite inserts a `{{name}}` reference into the
 * focused block, or drops its SQL into a new block when nothing is focused.
 */
export function CommandPalette() {
  const snippets = useGraftStore((s) => s.snippets);
  const focusedBlockId = useGraftStore((s) => s.focusedBlockId);
  const insertSnippetRef = useGraftStore((s) => s.insertSnippetRef);
  const addBlockFromSnippet = useGraftStore((s) => s.addBlockFromSnippet);
  const commands = useAppCommands();

  const open = useGraftStore((s) => s.paletteOpen);
  const setOpen = useGraftStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useGraftStore.getState().paletteOpen);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // Start from a clean search every time the palette opens, however it was
  // opened (shortcut, toolbar button or menu).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const commandItems: PaletteItem[] = commands
      .filter((command) => command.id !== PALETTE_COMMAND_ID)
      .filter((command) => command.isEnabled() && (!q || matches(q, command.label)))
      .map((command) => ({ kind: "command", command }));
    const favoriteItems: PaletteItem[] = snippets
      .filter((snippet) => !q || matches(q, snippet.name, snippet.sql))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((snippet) => ({ kind: "favorite", snippet }));
    return [...commandItems, ...favoriteItems];
    // `focusedBlockId` is a dependency because it changes which commands are enabled.
  }, [commands, snippets, query, focusedBlockId]);

  if (!open) return null;

  const choose = (item: PaletteItem) => {
    setOpen(false);
    if (item.kind === "command") {
      item.command.run();
    } else if (focusedBlockId) {
      insertSnippetRef(item.snippet.id);
    } else {
      addBlockFromSnippet(item.snippet.id);
    }
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Type a command or search favorite blocks…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              choose(items[active]);
            }
          }}
        />

        <div className="palette__list">
          {items.length === 0 && <div className="palette__empty">No match for “{query}”.</div>}
          {items.map((item, i) => (
            <button
              key={item.kind === "command" ? item.command.id : item.snippet.id}
              className={`palette__item${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              {item.kind === "command" ? (
                <>
                  <span className="badge badge--command">›</span>
                  <span className="palette__name">{item.command.label}</span>
                  {item.command.shortcut && (
                    <span className="palette__shortcut">{shortcutLabel(item.command.shortcut)}</span>
                  )}
                </>
              ) : (
                <>
                  <span className={`badge badge--${item.snippet.blockType}`}>
                    {item.snippet.blockType[0]}
                  </span>
                  <span className="palette__name">{`{{${item.snippet.name}}}`}</span>
                  <span className="palette__sql">
                    {item.snippet.sql.replace(/\s+/g, " ").slice(0, SQL_PREVIEW_LENGTH)}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        <div className="palette__hint">
          {focusedBlockId
            ? "↵ runs the command · a favorite inserts its {{reference}} into the focused block"
            : "↵ runs the command · a favorite opens as a new block"}
        </div>
      </div>
    </div>
  );
}
