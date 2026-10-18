import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { getCurrentAppAccess } from "@/lib/app-authorization";
import { AttendeeHome } from "@/components/attendee-home";
import { readOrderOverview } from "@/lib/order-reads";
import { buyerRequestContext } from "@/lib/buyer-request-context";

export const dynamic = "force-dynamic";

export default async function Home() {
  const access = hasConfiguredClerkKeys(process.env) ? await getCurrentAppAccess() : null;
  if (access && !access.ok && access.status === 401) redirect("/sign-in");
  if (access?.ok && access.role === "admin") redirect("/admin");
  if (access && !access.ok && access.status !== 401) return <section className="mx-auto max-w-xl px-5 py-12"><h1 className="text-3xl font-bold text-white">DIWO X 2.0</h1><p role="alert" className="mt-4 text-zinc-300">No hemos podido comprobar tu sesión y permisos. Actualiza la página.</p><Button asChild variant="secondary" className="mt-5"><Link href="/account">Mi cuenta</Link></Button></section>;
  if (!access?.ok) return <AttendeeHome />;
  const orders = await readOrderOverview("buyer");
  return <AttendeeHome requestContext={orders.ok ? buyerRequestContext(orders.orders) : null} />;
}
