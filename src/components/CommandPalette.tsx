import { useEffect, useMemo, useRef, useState } from "react";
import { useGraftStore } from "../store/useGraftStore";

/**
 * ⌘K / Ctrl+K action bar. For now it only searches saved favorite blocks:
 * pick one to insert a `{{name}}` reference into the focused block, or to drop
 * its SQL into a brand-new block when nothing is focused.
 */
export function CommandPalette() {
  const snippets = useGraftStore((s) => s.snippets);
  const focusedBlockId = useGraftStore((s) => s.focusedBlockId);
  const insertSnippetRef = useGraftStore((s) => s.insertSnippetRef);
  const addBlockFromSnippet = useGraftStore((s) => s.addBlockFromSnippet);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? snippets.filter(
          (s) =>
            s.name.toLowerCase().includes(q) || s.sql.toLowerCase().includes(q),
        )
      : snippets;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [snippets, query]);

  if (!open) return null;

  const choose = (id: string) => {
    // Focused editor → insert a reference; otherwise spawn a block with the SQL.
    if (focusedBlockId) insertSnippetRef(id);
    else addBlockFromSnippet(id);
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search favorite blocks…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              choose(results[active].id);
            }
          }}
        />

        <div className="palette__list">
          {snippets.length === 0 && (
            <div className="palette__empty">
              No favorite yet — right-click a block → “Save as favorite…”.
            </div>
          )}
          {snippets.length > 0 && results.length === 0 && (
            <div className="palette__empty">No match for “{query}”.</div>
          )}
          {results.map((s, i) => (
            <button
              key={s.id}
              className={`palette__item${i === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(s.id)}
            >
              <span className={`badge badge--${s.blockType}`}>
                {s.blockType[0]}
              </span>
              <span className="palette__name">{`{{${s.name}}}`}</span>
              <span className="palette__sql">{s.sql.replace(/\s+/g, " ").slice(0, 70)}</span>
            </button>
          ))}
        </div>

        <div className="palette__hint">
          {focusedBlockId
            ? "↵ inserts {{reference}} into the focused block"
            : "↵ creates a new block from the favorite"}
        </div>
      </div>
    </div>
  );
}
