import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "cn";

// Toolbar controls for the fork's chart pages, in the style of the app's
// Saved Keywords tag filter: a segmented group and a dropdown of the same
// height (h-9) and type size (text-sm), drawn like upstream's Select and
// segmented toggle; a narrowed filter is tinted primary. The dropdown
// renders through a portal in fixed position so no card can clip it, and
// can search a long list (countries).

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
      className="inline-flex h-9 max-w-full items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
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
            className={cn(
              "h-7 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-card font-medium text-foreground shadow-xs dark:bg-foreground/10"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
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
        className={cn(
          "inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border py-2 pr-2.5 pl-3 text-sm whitespace-nowrap text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          narrowed
            ? "border-primary/50 bg-primary/10"
            : "border-input bg-background hover:bg-foreground/5 aria-expanded:bg-foreground/5 dark:hover:bg-input/50",
        )}
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
        <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={cn(
                "fixed z-[1000] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10",
                menuWidth,
              )}
              style={{ top: position.top, left: position.left }}
            >
              {searchable ? (
                <div className="border-b border-border p-1.5">
                  <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
                className="max-h-64 overflow-y-auto p-1"
              >
                {visible.length === 0 ? (
                  <li className="px-3 py-6 text-center text-xs text-muted-foreground">
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
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
                            active
                              ? "font-medium text-foreground"
                              : "text-foreground/80",
                          )}
                          onClick={() => choose(option.value)}
                        >
                          <Check
                            className={cn(
                              "size-3.5 shrink-0",
                              active ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          {option.hint ? (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
