import { useEffect, useState } from "react";
import type { Cell } from "./resultShape";
import { copyToClipboard } from "./clipboard";

type FoldMode = "auto" | "open" | "closed";

/**
 * JSON result view — an interactive tree (fold/unfold like a JSON editor).
 * Feeds on either the re-nested relational document or the flat row objects.
 */
export function JsonTreeView({ items }: { items: unknown[] }) {
  const [mode, setMode] = useState<FoldMode>("auto");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Reset fold state when the shown slice changes (new query / page).
  useEffect(() => {
    setMode("auto");
    setOverrides({});
  }, [items]);

  const isOpen = (path: string, depth: number): boolean => {
    if (path in overrides) return overrides[path];
    if (mode === "open") return true;
    if (mode === "closed") return depth < 1; // keep the root array open
    return depth < 2; // auto: root + first level open, deeper collapsed
  };
  const toggle = (path: string, depth: number) =>
    setOverrides((o) => ({ ...o, [path]: !isOpen(path, depth) }));

  return (
    <div className="jsonx">
      <div className="jsonx__toolbar">
        <button
          className="btn jsonx__tbtn"
          onClick={() => {
            setMode("open");
            setOverrides({});
          }}
          title="Expand all"
        >
          ▼ all
        </button>
        <button
          className="btn jsonx__tbtn"
          onClick={() => {
            setMode("closed");
            setOverrides({});
          }}
          title="Collapse all"
        >
          ▶ all
        </button>
        <span className="text-muted">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="jsonx__body">
        <JsonNode
          keyName={undefined}
          value={items}
          depth={0}
          path=""
          isOpen={isOpen}
          toggle={toggle}
          isLast
        />
      </div>
    </div>
  );
}

function JsonNode({
  keyName,
  value,
  depth,
  path,
  isOpen,
  toggle,
  isLast,
}: {
  keyName: string | undefined;
  value: unknown;
  depth: number;
  path: string;
  isOpen: (path: string, depth: number) => boolean;
  toggle: (path: string, depth: number) => void;
  isLast: boolean;
}) {
  const comma = isLast ? "" : ",";
  const indent: React.CSSProperties = { paddingLeft: 6 + depth * 14 };
  const keyEl =
    keyName !== undefined ? (
      <>
        <span className="json-key">"{keyName}"</span>
        <span className="json-punct">: </span>
      </>
    ) : null;

  const isObject = value !== null && typeof value === "object";
  if (!isObject) {
    return (
      <div className="jsonx-row" style={indent}>
        <span className="jsonx-caret jsonx-caret--empty" />
        {keyEl}
        <JsonScalar value={value as Cell} />
        <span className="json-punct">{comma}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const open = isOpen(path, depth);
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  if (!open) {
    return (
      <div className="jsonx-row" style={indent}>
        <button className="jsonx-caret" onClick={() => toggle(path, depth)}>
          ▶
        </button>
        {keyEl}
        <span className="json-punct">{openBrace}</span>
        <button className="jsonx-collapsed" onClick={() => toggle(path, depth)}>
          {isArray ? `${entries.length} items` : `${entries.length} keys`}
        </button>
        <span className="json-punct">
          {closeBrace}
          {comma}
        </span>
      </div>
    );
  }

  return (
    <div className="jsonx-branch">
      <div className="jsonx-row" style={indent}>
        <button className="jsonx-caret" onClick={() => toggle(path, depth)}>
          ▼
        </button>
        {keyEl}
        <span className="json-punct">{openBrace}</span>
      </div>
      {entries.map(([k, v], i) => (
        <JsonNode
          key={k}
          keyName={isArray ? undefined : k}
          value={v}
          depth={depth + 1}
          path={`${path}/${k}`}
          isOpen={isOpen}
          toggle={toggle}
          isLast={i === entries.length - 1}
        />
      ))}
      <div className="jsonx-row" style={indent}>
        <span className="jsonx-caret jsonx-caret--empty" />
        <span className="json-punct">
          {closeBrace}
          {comma}
        </span>
      </div>
    </div>
  );
}

function JsonScalar({ value }: { value: Cell }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "number")
    return <span className="json-number">{String(value)}</span>;
  if (typeof value === "boolean")
    return <span className="json-bool">{String(value)}</span>;
  const text = String(value);
  return (
    <span
      className="json-string"
      title="Double-click to copy"
      onDoubleClick={() => copyToClipboard(text)}
    >
      "{text}"
    </span>
  );
}
