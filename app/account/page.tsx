import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BuyerFlowLink as Link } from "@/components/buyer-flow-link";
import { Button } from "@/components/ui/button";
import { AccountActions, AccountEmail } from "@/components/account-actions";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { getCurrentAppAccess } from "@/lib/app-authorization";
import { readOrderOverview } from "@/lib/order-reads";
import { buyerRequestContext } from "@/lib/buyer-request-context";
import { NewOrderLink } from "@/components/new-order-link";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!hasConfiguredClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const access = await getCurrentAppAccess();
  // Admin Home stays dedicated to management; keep its personal purchase entry
  // here, using the same safe new-request action as the attendee Home.
  const personal = access.ok && access.role === "admin" ? await readOrderOverview("buyer") : null;
  const requestContext = personal?.ok ? buyerRequestContext(personal.orders) : null;

  return (
    <section className="diwo-account">
      <header className="diwo-account-header">
        <h1>Mi cuenta</h1>
        <AccountEmail />
      </header>
      {!access.ok && <p role="alert" className="text-sm text-zinc-300">No hemos podido comprobar los permisos de tu cuenta. Actualiza la página.</p>}
      <div className="diwo-account-links">
        <Button asChild variant="secondary" className="diwo-account-link"><Link href="/ticket">Mis entradas</Link></Button>
        {access.ok && access.role === "door_staff" && <Button asChild variant="secondary" className="diwo-account-link"><Link href="/scan">Abrir escáner</Link></Button>}
        {access.ok && access.role === "admin" &&
          <NewOrderLink eventId={requestContext?.eventId ?? null} recorded={requestContext?.recorded ?? []} label="Solicitar entradas" />}
      </div>
      <AccountActions />
    </section>
  );
}
