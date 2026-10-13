import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OrderRequestForm } from "@/components/order-request-form";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { getOrderSalesAvailability } from "@/lib/order-sales";
import { getCurrentAppAccess } from "@/lib/app-authorization";
import { paymentPhone } from "@/lib/order-payment-state";

export const dynamic = "force-dynamic";

export default async function RequestPage() {
  if (!hasDevelopmentClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const availability = await getOrderSalesAvailability();
  const access = availability.state === "unpublished" ? await getCurrentAppAccess() : null;
  const previewAllowed = access?.ok === true && access.role === "admin";
  return <OrderRequestForm availability={availability} previewAllowed={previewAllowed}
    phone={availability.state === "open" ? paymentPhone(process.env.DIWO_BIZUM_PHONE) : null} />;
}
