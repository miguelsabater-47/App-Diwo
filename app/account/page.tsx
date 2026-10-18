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
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="shrink-0 text-3xl font-bold text-white">Mi cuenta</h1>
        <AccountEmail />
      </header>
      {access.ok && access.role === "admin" && <p className="text-sm text-zinc-300">Cuenta de administración · La gestión está en el menú inferior. Tus compras personales siguen disponibles aquí.</p>}
      {access.ok && access.role === "door_staff" && <div className="rounded-2xl border border-primary/40 bg-card p-6"><h2 className="text-xl font-bold text-primary">Control de acceso</h2><p className="mt-3 text-sm text-zinc-400">Tu permiso de puerta está activo.</p><Button asChild className="mt-4 min-h-12"><Link href="/scan">Abrir escáner</Link></Button></div>}
      {!access.ok && <p role="alert" className="text-sm text-zinc-300">No hemos podido comprobar los permisos de tu cuenta. Actualiza la página.</p>}
      <Button asChild className="min-h-12"><Link href="/">Ir a Inicio</Link></Button>
      <Button asChild variant="secondary" className="min-h-12"><Link href="/ticket">Mis entradas</Link></Button>
      {access.ok && access.role === "admin" &&
        <NewOrderLink eventId={requestContext?.eventId ?? null} recorded={requestContext?.recorded ?? []} label="Solicitar entradas" />}
      <AccountActions />
    </section>
  );
}
