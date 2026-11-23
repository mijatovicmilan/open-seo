import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

// Toolbar controls for the fork's chart pages, in the style of the app's
// Saved Keywords tag filter: a segmented group and a dropdown of the same
// height (h-9) and type size (text-sm); a narrowed filter is tinted primary. The dropdown renders through a portal in fixed position so
// no card can clip it, and can search a long list (countries).

export function SegmentGroup<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex h-9 items-center rounded-md border border-base-300 bg-base-100 p-0.5"
      role="group"
      aria-label={label}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            className={`h-7 rounded px-2.5 text-sm transition-colors ${
              active
                ? "bg-base-content/10 font-medium text-base-content"
                : "text-base-content/60 hover:bg-base-200 hover:text-base-content"
            }`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  /** Muted text on the right ("253", "auto"). */
  hint?: string;
};

export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  display,
  searchable = false,
  searchPlaceholder = "Search",
  menuWidth = "w-56",
  narrowed = false,
}: {
  /** Accessible name and the muted prefix shown when nothing is narrowed. */
  label: string;
  value: T;
  options: Array<ChoiceOption<T>>;
  onChange: (value: T) => void;
  /** Trigger text; defaults to the selected option's label. */
  display?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  menuWidth?: string;
  /** Tint the trigger when this filter narrows the data. */
  narrowed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(needle) ||
          option.value.toLowerCase().includes(needle),
      )
    : options;

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (buttonRef.current?.contains(target) ||
          menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // A wide menu near the right edge moves left to stay inside the window.
  useLayoutEffect(() => {
    const width = menuRef.current?.offsetWidth;
    if (!open || !width) return;
    const room = window.innerWidth - 8 - width;
    if (position.left > room) {
      setPosition((current) => ({ ...current, left: Math.max(8, room) }));
    }
  }, [open, position.left]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-9 max-w-full items-center gap-2 rounded-md border px-3 text-sm transition ${
          narrowed
            ? "border-primary/50 bg-primary/10 text-base-content"
            : "border-base-300 bg-base-100 hover:border-base-content/30"
        }`}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            // Keep the menu inside the viewport on narrow screens.
            const left = Math.min(rect.left, window.innerWidth - 240);
            setPosition({ top: rect.bottom + 4, left: Math.max(8, left) });
          }
          setOpen((current) => !current);
        }}
      >
        <span className="truncate">{display ?? selected?.label ?? label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={`fixed z-[1000] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-2xl ${menuWidth}`}
              style={{ top: position.top, left: position.left }}
            >
              {searchable ? (
                <div className="border-b border-base-300 p-2">
                  <label className="flex items-center gap-2 rounded-md border border-base-300 bg-base-200/50 px-2 py-1.5">
                    <Search className="size-3.5 opacity-50" />
                    <input
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/40"
                      placeholder={searchPlaceholder}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        const first = visible[0];
                        if (event.key === "Enter" && first) choose(first.value);
                      }}
                    />
                  </label>
                </div>
              ) : null}
              <ul
                role="listbox"
                aria-label={label}
                className="max-h-64 overflow-y-auto"
              >
                {visible.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-base-content/55">
                    No match
                  </li>
                ) : (
                  visible.map((option) => {
                    const active = option.value === value;
                    return (
                      <li
                        key={option.value}
                        role="option"
                        aria-selected={active}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200 ${active ? "font-medium text-base-content" : "text-base-content/80"}`}
                          onClick={() => choose(option.value)}
                        >
                          <Check
                            className={`size-3.5 shrink-0 ${active ? "opacity-100" : "opacity-0"}`}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          {option.hint ? (
                            <span className="shrink-0 text-xs tabular-nums text-base-content/45">
                              {option.hint}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
