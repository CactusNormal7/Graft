import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuAction =
  | {
      label: string;
      onClick?: () => void;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      separator?: false;
    }
  | { separator: true; label?: never; onClick?: never };

interface Props {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}

/**
 * Small custom right-click menu, portaled to <body> so it isn't clipped by the
 * block's `overflow: hidden`. Positions itself at (x, y), then adjusts to stay
 * inside the viewport. Closes on outside click, Escape, or after an action.
 */
export function BlockContextMenu({ x, y, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth: vw, innerHeight: vh } = window;
    const rect = el.getBoundingClientRect();
    const nx = Math.min(x, vw - rect.width - 8);
    const ny = Math.min(y, vh - rect.height - 8);
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // `mousedown` on capture so we close before React Flow processes drag.
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((a, i) => {
        if (a.separator) return <div key={i} className="ctx-menu__sep" />;
        return (
          <button
            key={i}
            className={`ctx-menu__item${a.danger ? " is-danger" : ""}`}
            disabled={a.disabled}
            onClick={() => {
              a.onClick?.();
              onClose();
            }}
          >
            <span className="ctx-menu__label">{a.label}</span>
            {a.shortcut && <span className="ctx-menu__shortcut">{a.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
