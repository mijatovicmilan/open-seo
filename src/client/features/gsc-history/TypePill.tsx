import { cn } from "cn";
import { TableCell } from "@/client/components/ui/table";
import {
  pageSection,
  sectionLabel,
  TOP_LEVEL_SECTION,
} from "@/shared/pageSection";

// Fork addition (FORK-CHANGES.md): a page type as a coloured pill. The hue
// comes from the type's name, so a type keeps its colour on every page and
// every site; top-level pages stay neutral.
const TYPE_HUES = [40, 75, 357, 255, 130, 162, 200, 300];

function typeHue(section: string): number {
  let hash = 0;
  for (const char of section) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return TYPE_HUES[hash % TYPE_HUES.length];
}

export function TypePill({ url }: { url: string }) {
  const section = pageSection(url);
  const top = section === TOP_LEVEL_SECTION;
  const hue = typeHue(section);
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        top && "border-border bg-muted text-muted-foreground",
      )}
      style={
        top
          ? undefined
          : {
              backgroundColor: `oklch(70% 0.14 ${hue} / 0.16)`,
              borderColor: `oklch(70% 0.14 ${hue} / 0.35)`,
              color: `color-mix(in oklab, oklch(65% 0.15 ${hue}) 75%, var(--foreground))`,
            }
      }
    >
      {sectionLabel(section)}
    </span>
  );
}

/** The page's type, its first folder. */
export function TypeCell({ url }: { url: string | null }) {
  return (
    <TableCell>
      {url ? (
        <TypePill url={url} />
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
  );
}
