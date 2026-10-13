import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";
import { NavButton } from "@/components/nav-button";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!hasDevelopmentClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="mx-auto max-w-xl px-5 py-10 text-zinc-300">No hemos podido verificar tus permisos. Actualiza la página.</section>;
  }
  return <div>
    <div className="mx-auto max-w-4xl px-5 pt-6"><Link href="/" className="inline-flex min-h-11 items-center rounded-lg text-sm text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-primary">← Volver a Inicio</Link></div>
    {children}
    <nav aria-label="Administración" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-xl grid-cols-4 gap-1 px-2 py-3">
        <NavButton href="/admin" exact className="min-h-12 px-2 text-xs">Resumen</NavButton>
        <NavButton href="/admin/requests" className="min-h-12 px-2 text-xs">Solicitudes</NavButton>
        {['Entradas', 'Personal'].map((label) => <span key={label} aria-disabled="true" className="flex min-h-12 items-center justify-center px-1 text-center text-xs text-zinc-500">{label}<span className="sr-only"> · En preparación</span></span>)}
      </div>
    </nav>
  </div>;
}
