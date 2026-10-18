import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAdminAccess } from "@/lib/app-authorization";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { ScanRehearsal } from "@/components/scan-rehearsal";

export const dynamic = "force-dynamic";
export default async function ScanRehearsalPage({ searchParams }: { searchParams?: Promise<{ design?: string }> } = {}) {
  if (process.env.NODE_ENV !== "development" || !hasDevelopmentClerkKeys(process.env) || (await headers()).get("host") !== "localhost:3000") notFound();
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="p-6">No se han podido verificar tus permisos. No se ha abierto el ensayo.</section>;
  }
  // The design now lives in the actual scanner. Keep old bookmarks as a redirect.
  if ((await searchParams)?.design === "1") redirect("/admin/scan");
  return <section className="mx-auto max-w-xl px-5 pb-32 pt-8 text-white">
    <h1 className="text-3xl font-bold">Ensayo del escáner</h1>
    <p className="mt-3 text-sm text-zinc-400">Herramienta local de administrador · Separada de /scan</p>
    <ScanRehearsal />
  </section>;
}
