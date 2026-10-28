import { AdminEventDashboard } from "@/components/admin-event-dashboard";
import "@/components/admin-event-dashboard.css";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  // Admin layout protects the screen; each API read/write independently checks DB role.
  return <AdminEventDashboard />;
}
