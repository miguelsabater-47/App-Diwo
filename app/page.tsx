import Link from "next/link";
import { LayoutDashboard, ClipboardList, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { getCurrentAppAccess } from "@/lib/app-authorization";
import { readOrderOverview } from "@/lib/order-reads";
import { orderSummary } from "@/lib/order-view-model";

export const dynamic = "force-dynamic";

export default async function Home() {
  const access = hasDevelopmentClerkKeys(process.env) ? await getCurrentAppAccess() : null;
  if (access?.ok && access.role === "admin") {
    const data = await readOrderOverview("admin");
    return <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">DIWO X 2.0 · Gestión</p>
      <h1 className="mb-7 text-3xl font-bold text-white">Inicio</h1>
      <Link href="/admin" className="block rounded-2xl bg-primary p-6 text-black outline-none focus-visible:ring-2 focus-visible:ring-white"><LayoutDashboard aria-hidden="true" className="mb-5 size-9" /><h2 className="text-2xl font-bold">Panel de administración</h2><p className="mt-3">Gestionar solicitudes, entradas y personal</p></Link>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/requests" className="rounded-2xl border border-zinc-800 bg-card p-5 outline-none focus-visible:ring-2 focus-visible:ring-primary"><ClipboardList aria-hidden="true" className="mb-4 size-7 text-primary" /><h2 className="font-semibold text-white">Solicitudes pendientes</h2><p className="mt-3 text-3xl font-bold text-primary">{data.ok ? orderSummary(data.orders).pending : "—"}</p>{!data.ok && <p className="mt-2 text-xs text-zinc-400">No hemos podido actualizar el recuento.</p>}</Link>
        <div aria-disabled="true" className="rounded-2xl border border-zinc-800 bg-card p-5"><ScanLine aria-hidden="true" className="mb-4 size-7 text-zinc-500" /><h2 className="font-semibold text-zinc-300">Control de acceso</h2><p className="mt-3 text-sm text-zinc-500">En preparación</p></div>
      </div>
    </section>;
  }
  if (access && !access.ok && access.status !== 401) return <section className="mx-auto max-w-xl px-5 py-12"><h1 className="text-3xl font-bold text-white">DIWO X 2.0</h1><p role="alert" className="mt-4 text-zinc-300">No hemos podido comprobar tu sesión y permisos. Actualiza la página.</p><Button asChild variant="secondary" className="mt-5"><Link href="/account">Mi cuenta</Link></Button></section>;
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:py-16">
    <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">Halloween party</p>
    <h1 className="text-5xl font-black tracking-tight text-white sm:text-7xl">DIWO X 2.0</h1>
    <p className="text-xl text-zinc-200">31 de octubre · 23:00 a 07:00</p>
    <div className="rounded-2xl border border-zinc-800 bg-card p-6"><p className="font-semibold text-white">Casa de campo en Ceutí</p><p className="mt-3 text-sm leading-relaxed text-zinc-400">Te esperamos entre las 23:30 y la 01:30. La dirección exacta se compartirá en el grupo de WhatsApp el último día.</p></div>
    <div className="flex flex-wrap items-center gap-5"><p className="text-4xl font-bold text-primary">5 € <span className="text-base font-normal text-zinc-400">por entrada</span></p><Button asChild className="min-h-12"><Link href="/request">Solicitar entradas</Link></Button></div>
    <p className="text-sm leading-relaxed text-zinc-400">Las entradas saldrán cuando la app esté lista y la organización active la venta. Un Bizum por solicitud y una entrada por persona.</p>
  </section>;
}
