import { useQuery } from "@tanstack/react-query";
import { getOutreachLinkTraffic } from "@/serverFunctions/analyticsSource";

// Fork addition (FORK-CHANGES.md): visits and signups each earned link
// brought, from PostHog. Nothing shows for projects without PostHog.

function useLinkTraffic(projectId: string, number: number) {
  const query = useQuery({
    queryKey: ["outreachLinkTraffic", projectId],
    queryFn: () => getOutreachLinkTraffic({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
  const result = query.data;
  if (!result) return { link: null, error: null };
  if (!result.ok) return { link: null, error: result.message };
  if (!result.value.available) return { link: null, error: null };
  return {
    link: result.value.links.find((item) => item.number === number) ?? null,
    keyEvents: result.value.source.keyEvents,
    error: null,
  };
}

const plural = (count: number, word: string) =>
  `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/** "12 visits · 1 signup since Nov 3", for the Links list. */
export function LinkTrafficInline({
  projectId,
  number,
}: {
  projectId: string;
  number: number;
}) {
  const { link } = useLinkTraffic(projectId, number);
  if (!link) return null;
  return (
    <span
      className="text-xs tabular-nums text-base-content/70"
      title={`PostHog visits from ${link.site} since ${link.since}`}
    >
      {plural(link.visits, "visit")} · {plural(link.signups, "signup")}
    </span>
  );
}

/** The prospect panel's "Traffic from this link". */
export function LinkTrafficSection({
  projectId,
  number,
}: {
  projectId: string;
  number: number;
}) {
  const { link, error, keyEvents } = useLinkTraffic(projectId, number);
  if (error) {
    return (
      <p role="alert" className="text-sm text-error">
        Traffic from PostHog: {error}
      </p>
    );
  }
  if (!link) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
        Traffic from this link
      </h3>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        {(
          [
            ["Visits", link.visits],
            ["From the page", link.fromPage.visits],
            ["Signups", link.signups],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-base-300 p-2">
            <dt className="text-xs text-base-content/60">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {value.toLocaleString("en-US")}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-base-content/60">
        PostHog visits referred by {new URL(link.theirPage).hostname} since{" "}
        {link.since}
        {link.lastVisitAt ? `, last on ${link.lastVisitAt}` : ""}. A signup is a
        visit with {keyEvents?.length ? keyEvents.join(" or ") : "a key event"}.
        "From the page" counts visits whose referrer is the linking page itself
        (zero when the site sends only its domain).
      </p>
    </section>
  );
}
