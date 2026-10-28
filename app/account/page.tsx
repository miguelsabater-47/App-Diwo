import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AccountActions, AccountIdentity } from "@/components/account-actions";
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
      </header>
      <div className="diwo-account-profile">
        <AccountIdentity />
        <AccountActions />
      </div>
      {!access.ok && <p role="alert" className="text-sm text-zinc-300">No hemos podido comprobar los permisos de tu cuenta. Actualiza la página.</p>}
      {access.ok && access.role === "admin" && <div className="diwo-account-links">
        {access.ok && access.role === "admin" &&
          <NewOrderLink eventId={requestContext?.eventId ?? null} recorded={requestContext?.recorded ?? []} label="Solicitar entradas" />}
      </div>}
    </section>
  );
}
