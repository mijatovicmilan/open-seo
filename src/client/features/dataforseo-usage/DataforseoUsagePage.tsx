import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { CardShell } from "@/client/components/CardShell";
import { EmptyState } from "@/client/components/EmptyState";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { creditFeatureLabel } from "@/shared/billing-credit-features";
import { getDataforseoUsage } from "@/serverFunctions/dataforseo-usage";

// Fork feature (FORK-CHANGES.md): what this install's DataForSEO calls cost.

// Most calls cost fractions of a cent, so show up to four decimals.
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const time = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function DataforseoUsagePage() {
  const query = useQuery({
    queryKey: ["dataforseoUsage"],
    queryFn: () => getDataforseoUsage(),
  });
  return (
    <QueryState query={query} errorFallback="Could not load DataForSEO usage">
      {(usage) => (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionHeader
              title="DataForSEO usage"
              hint={`What OpenSEO's DataForSEO calls cost in the last ${usage.windowDays} days, as DataForSEO reported each one. Calls that fail without a charge, such as on an empty balance, are not listed.`}
            />
            <p className="text-sm text-muted-foreground">
              {usage.automaticCallsOff
                ? "Automatic calls are off (DATAFORSEO_AUTO_CALLS=off): the dashboard's backlink cards and a rank tracker's suggestions, first check and stats wait for a click. Searches and checks you start still run."
                : "Automatic calls are on: the dashboard's backlink cards load once a day, and a rank tracker checks new keywords as soon as they are added. Set DATAFORSEO_AUTO_CALLS=off in .env to stop them."}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Balance"
                value={
                  usage.balanceUsd === null
                    ? "Unavailable"
                    : usd.format(usage.balanceUsd)
                }
              />
              <Stat
                label={`Spent, ${usage.windowDays} days`}
                value={usd.format(usage.totalCostUsd)}
              />
              <Stat
                label={`Calls, ${usage.windowDays} days`}
                value={usage.totalCalls.toLocaleString()}
              />
            </div>
          </section>

          {usage.recent.length === 0 ? (
            <EmptyState
              variant="card"
              icon={Receipt}
              title="No DataForSEO calls logged yet"
              description="Each paid call is logged from now on, with what it was for and what it cost."
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <CardShell title="By feature">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.byFeature.map((row) => (
                        <TableRow key={row.feature}>
                          <TableCell>
                            {creditFeatureLabel(row.feature)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.calls.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {usd.format(row.costUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardShell>
                <CardShell title="By endpoint and project">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.byEndpoint.map((row) => (
                        <TableRow
                          key={`${row.feature}:${row.endpoint}:${row.projectId}`}
                        >
                          <TableCell className="font-mono text-xs">
                            {row.endpoint}
                          </TableCell>
                          <TableCell>{row.projectName ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.calls.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {usd.format(row.costUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardShell>
              </div>

              <CardShell title="Latest calls">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Feature</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.recent.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">
                          {time.format(new Date(row.createdAt))}
                        </TableCell>
                        <TableCell>{creditFeatureLabel(row.feature)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.endpoint}
                        </TableCell>
                        <TableCell>{row.projectName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {usd.format(row.costUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardShell>
            </>
          )}
        </div>
      )}
    </QueryState>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
