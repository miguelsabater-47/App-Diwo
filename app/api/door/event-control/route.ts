// Operational endpoint only; both handlers check current DB role independently.
export { GET, POST } from "@/app/api/admin/event-control/route";
export const dynamic = "force-dynamic";
