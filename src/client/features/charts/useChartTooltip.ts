import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChartNote } from "@/client/features/charts/TimeSeriesChart";

// The chart tooltip's state (fork feature). Hover shows a day; a card with
// marks waits a moment before following the pointer, so the pointer can
// cross a day or two to reach it; a click (or tap, or the arrow keys) pins
// it until a click outside, Escape or its close button.

export type ShownDay = {
  key: string;
  /** Position in the chart box, in pixels. */
  x: number;
  y: number;
  /** Every mark of a merged marker, when the marker was clicked. */
  group?: ChartNote[];
};

const DELAY = 280;

export function useChartTooltip(
  boxRef: RefObject<HTMLDivElement | null>,
  isInteractive: (day: ShownDay) => boolean,
) {
  const [shown, setShown] = useState<ShownDay | null>(null);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<ShownDay | null>(null);
  // recharts reports leaving the chart a frame late, after the pointer may
  // already be on the card; the card's own state wins.
  const overCard = useRef(false);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
  }, []);

  const close = useCallback(() => {
    clear();
    overCard.current = false;
    setPinned(false);
    setShown(null);
  }, [clear]);

  // Applies the latest pending day (or hides) after the delay; moves in the
  // meantime only replace the target.
  const later = (next: ShownDay | null) => {
    pending.current = next;
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (!overCard.current) setShown(pending.current);
    }, DELAY);
  };

  const hover = (next: ShownDay) => {
    if (pinned) return;
    if (shown?.key === next.key) {
      clear();
      return;
    }
    if (shown && isInteractive(shown)) {
      later(next);
      return;
    }
    clear();
    setShown(next);
  };

  const leave = () => {
    if (!pinned) later(null);
  };

  const pin = (next: ShownDay) => {
    clear();
    setShown(next);
    setPinned(true);
  };

  /** A click on a day pins it; a second click on the pinned day unpins. */
  const click = (next: ShownDay) => {
    if (pinned && shown?.key === next.key && !shown.group) {
      setPinned(false);
      return;
    }
    pin(next);
  };

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const box = boxRef.current;
      const hadFocus = box?.contains(document.activeElement) ?? false;
      close();
      if (hadFocus) box?.focus();
    };
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        boxRef.current?.contains(event.target)
      )
        return;
      close();
    };
    document.addEventListener("keydown", onKey);
    if (pinned) document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", outside);
    };
  }, [shown, pinned, boxRef, close]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    shown,
    pinned,
    hover,
    leave,
    click,
    pin,
    close,
    /** The pointer reached the card: keep it. */
    enterCard: () => {
      overCard.current = true;
      clear();
    },
    leaveCard: () => {
      overCard.current = false;
      leave();
    },
  };
}
