import { cn } from "cn";

/** A site's favicon, loaded from Google's public favicon service. */
export function DomainFavicon({
  domain,
  className,
}: {
  domain: string;
  /** Fork addition (FORK-CHANGES.md): a bigger icon in the project switcher. */
  className?: string;
}) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      className={cn("size-4 shrink-0 rounded", className)}
      loading="lazy"
    />
  );
}
