import { notFound, redirect } from "next/navigation";
import { requireDoorAccess } from "@/lib/app-authorization";
import { AdminEventDashboard } from "@/components/admin-event-dashboard";
import "@/components/admin-event-dashboard.css";

export const dynamic = "force-dynamic";
export default async function DoorHomePage() {
  const access = await requireDoorAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="p-6">No hemos podido verificar tus permisos. Vuelve a iniciar sesión.</section>;
  }
  if (access.role === "admin") redirect("/admin");
  return <AdminEventDashboard role="door_staff" />;
}
