import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getKeywordGscPositions } from "@/serverFunctions/gscHistory";

// Fork feature (FORK-CHANGES.md). Kept apart from KeywordGscPosition.tsx so
// the report widgets bundle never pulls in a server function.

/** Positions by keyword, for the keywords on screen. */
export function useKeywordGscPositions(projectId: string, keywords: string[]) {
  const shown = keywords.slice(0, 500);
  const query = useQuery({
    queryKey: ["keywordGscPositions", projectId, shown],
    queryFn: () =>
      getKeywordGscPositions({ data: { projectId, keywords: shown } }),
    enabled: shown.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  return useMemo(
    () => new Map(query.data?.rows.map((row) => [row.keyword, row]) ?? []),
    [query.data],
  );
}
