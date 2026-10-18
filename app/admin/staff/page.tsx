import { notFound, redirect } from "next/navigation";
import { requireAdminAccess } from "@/lib/app-authorization";
import { DoorStaffManager } from "@/components/door-staff-manager";

export const dynamic = "force-dynamic";
export default async function StaffPage() {
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="mx-auto max-w-xl px-5 py-10 text-zinc-300">No hemos podido verificar tus permisos. Actualiza la página.</section>;
  }
  return <section className="diwo-admin-requests">
    <h1 className="sr-only">Personal de puerta</h1>
    <DoorStaffManager />
  </section>;
}
