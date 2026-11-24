import { CirclePause } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";

/**
 * Fork feature (FORK-CHANGES.md): shown in place of DataForSEO data that was
 * never loaded while automatic calls are off.
 */
export function LoadDataforseoPrompt({
  cost,
  onLoad,
  isLoading,
}: {
  /** What one load costs, e.g. "about $0.05". */
  cost: string;
  onLoad: () => void;
  isLoading: boolean;
}) {
  return (
    <EmptyState
      variant="plain"
      icon={CirclePause}
      title="Automatic DataForSEO calls are off"
      description={`Load this when you want it. It uses DataForSEO credits (${cost}) and is saved for a day.`}
      action={
        <Button variant="outline" onClick={onLoad} disabled={isLoading}>
          {isLoading ? "Loading…" : "Load"}
        </Button>
      }
    />
  );
}
