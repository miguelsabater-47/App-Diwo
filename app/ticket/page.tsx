import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";

export const dynamic = "force-dynamic";

export default async function TicketPage() {
  if (!hasDevelopmentClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">Mis entradas</h1>
      <p className="text-zinc-300">Las solicitudes y entradas están en preparación. Este paso solo prueba el acceso; no consulta ni emite tickets.</p>
      <Button asChild variant="secondary"><Link href="/account">Volver a mi cuenta</Link></Button>
    </section>
  );
}
