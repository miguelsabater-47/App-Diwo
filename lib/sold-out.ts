import "server-only";
import { readOrderOverview } from "@/lib/order-reads";
import type { AppAccess } from "@/lib/app-authorization-core";

/** Applies in every environment. A failed read never means a buyer has no tickets. */
export async function showSoldOut(access: AppAccess): Promise<boolean> {
  if (!access.ok || access.role !== "user") return false;
  const personal = await readOrderOverview("buyer");
  // Keep ALL existing requests/history accessible, including pending payments.
  return personal.ok && personal.orders.length === 0;
}
