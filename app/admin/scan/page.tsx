import { notFound, redirect } from "next/navigation";
import { requireAdminAccess } from "@/lib/app-authorization";
import { DoorScanner } from "@/components/door-scanner";
import { getDoorScanDevelopmentState } from "@/lib/door-scan-development";

export const dynamic = "force-dynamic";

export default async function AdminScanPage() {
  // Independent page gate as well as the admin layout; API checks current door role again.
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="mx-auto max-w-xl px-5 py-7 text-zinc-300">No hemos podido verificar tus permisos. Actualiza antes de escanear.</section>;
  }
  const development = await getDoorScanDevelopmentState(access.role);
  return <section className="diwo-admin-requests" style={{ maxWidth: 620 }}>
    <h1 className="sr-only">Escáner</h1>
    <header className="diwo-admin-requests-tools"><div className="diwo-admin-requests-intro"><p className="diwo-admin-section-label">Control de acceso</p><p>Solo online · Un acceso por entrada · Sin reentrada</p></div></header>
    <DoorScanner key={development ? JSON.stringify(development) : "live"} development={development} />
  </section>;
}
