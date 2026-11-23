import { useCallback, useRef, useState } from "react";

// The width of a chart's box, kept current with a ResizeObserver (fork
// feature; upstream's rank-tracking chart no longer exports its own).
export function useChartWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return { containerRef, width };
}
