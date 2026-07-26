import { useEffect, useRef } from "react";

/**
 * Keeps wheel scrolling inside a block's scrollable area instead of panning the
 * canvas — but only while `enabled` (i.e. the block is selected/focused).
 *
 * Why not React Flow's `nowheel` class: it makes React Flow ignore *every*
 * wheel event over the element, which also kills pinch-to-zoom. A pinch arrives
 * as a wheel event with `ctrlKey`, so here we simply let those bubble through to
 * React Flow and stop only plain scrolls.
 *
 * The listener must be native (not React's synthetic `onWheel`): React attaches
 * at the root, so by the time a synthetic handler runs the event has already
 * reached React Flow's own pane listener and `stopPropagation` would be too
 * late.
 */
export function useInnerScroll<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-to-zoom → let React Flow zoom the canvas
      if (!enabled) return; // not focused → let React Flow pan the canvas
      // Focused: the browser scrolls this element natively; just make sure the
      // canvas doesn't also pan.
      e.stopPropagation();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled]);

  return ref;
}
