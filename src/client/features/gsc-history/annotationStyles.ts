import type { Insights } from "@/client/features/gsc-history/types";

type Annotation = Insights["annotations"][number];

export const ANNOTATION_STYLES: Record<
  Annotation["kind"],
  { color: string; label: string }
> = {
  // Theme tokens, so notes follow the app's light and dark palettes.
  deploy: { color: "var(--color-warning)", label: "Deploy" },
  page: { color: "var(--color-success)", label: "Page" },
  link: { color: "var(--color-secondary)", label: "Link" },
  note: {
    color: "color-mix(in oklab, var(--color-base-content) 45%, transparent)",
    label: "Note",
  },
  outreach: { color: "var(--color-secondary)", label: "Outreach link" },
  first_seen: { color: "var(--color-info)", label: "New page" },
};

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
