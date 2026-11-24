import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  DataforseoChargedTaskError,
  type DataforseoApiCallCost,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

/**
 * Fork feature (FORK-CHANGES.md): runs a self-hosted install's DataForSEO
 * call and logs what it cost, including a call DataForSEO charged for that
 * still failed.
 */
export async function callAndLogDataforseo<T>(
  customer: BillingCustomerContext,
  execute: () => Promise<DataforseoApiResponse<T>>,
  feature: string,
): Promise<T> {
  try {
    const result = await execute();
    await logCall(customer, result.billing, feature);
    return result.data;
  } catch (error) {
    if (error instanceof DataforseoChargedTaskError)
      await logCall(customer, error.billing, feature);
    throw error;
  }
}

// A failed write never fails the call it describes.
async function logCall(
  customer: BillingCustomerContext,
  billing: DataforseoApiCallCost,
  feature: string,
) {
  try {
    // Loaded here, not at the top: the DataForSEO client is imported by
    // modules (and their tests) that never touch the database.
    const { DataforseoCallRepository } =
      await import("./repositories/DataforseoCallRepository");
    await DataforseoCallRepository.insert({
      organizationId: customer.organizationId,
      projectId: customer.projectId ?? null,
      endpoint: billing.path.filter((part) => part !== "v3").join("/"),
      feature,
      costUsd: billing.costUsd,
    });
  } catch (error) {
    console.warn("[dataforseo-usage] could not log a call", error);
  }
}
