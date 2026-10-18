import { runDoorStaff } from "@/lib/door-staff";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return runDoorStaff(request); }
export async function POST(request: Request) { return runDoorStaff(request); }
