import { useQuery } from "@tanstack/react-query";
import { DomainFavicon } from "@/client/features/ai-visibility/DomainFavicon";
import { getProjectFaviconFn } from "@/serverFunctions/projectFavicon";

/** Fork feature (FORK-CHANGES.md): the project's own favicon, read from its
 *  site by the server (kept for a day); Google's favicon service until it
 *  arrives or when the site has none we can read. */
export function ProjectIcon({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string;
}) {
  const icon = useQuery({
    queryKey: ["projectFavicon", projectId, domain],
    queryFn: () => getProjectFaviconFn({ data: { projectId } }),
    staleTime: 60 * 60_000,
    retry: false,
  });
  if (!icon.data) {
    return <DomainFavicon domain={domain} className="size-6 rounded-md" />;
  }
  return (
    <img
      src={icon.data}
      alt=""
      className="size-6 shrink-0 rounded-md object-contain"
    />
  );
}
