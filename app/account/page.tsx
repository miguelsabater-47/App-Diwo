import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AccountActions } from "@/components/account-actions";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  if (!hasDevelopmentClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">Mi cuenta</h1>
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold text-primary">Sesión verificada en el servidor</h2>
        <p className="mt-3 text-zinc-300">Tu acceso a DIWO está activo. Esta página comprueba tu sesión antes de mostrar su contenido.</p>
      </div>
      <AccountActions />
      <Button asChild variant="secondary"><Link href="/ticket">Mis entradas · en preparación</Link></Button>
      <p className="text-sm text-zinc-400">Los permisos de administración y acceso se configurarán en Supabase en otro bloque. Esta prueba no asigna roles.</p>
    </section>
  );
}
