import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireDoorAccess } from "@/lib/app-authorization";
import { DoorScanner } from "@/components/door-scanner";
import { getDoorScanDevelopmentState } from "@/lib/door-scan-development";

export const dynamic = "force-dynamic";
export default async function ScanPage() {
  const access = await requireDoorAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <main role="alert" className="p-6">No se han podido verificar tus permisos. Actualiza antes de continuar.</main>;
  }
  const development = await getDoorScanDevelopmentState(access.role);
  return <section className="diwo-admin-requests" style={{ maxWidth: 620 }}>
    <header className="diwo-admin-detail-heading"><Link href={access.role === "admin" ? "/admin" : "/door"} className="diwo-request-back" aria-label="Volver al inicio"><ArrowLeft aria-hidden="true" /></Link><h1 className="text-xl font-bold">Control de acceso</h1></header>
    <p className="diwo-door-note" style={{ marginBottom: 12 }}>Solo online · Un acceso por entrada · Sin reentrada</p>
    <DoorScanner key={development ? JSON.stringify(development) : "live"} development={development} />
  </section>;
}
