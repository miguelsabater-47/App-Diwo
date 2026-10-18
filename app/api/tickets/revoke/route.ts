import { runOrderMutation } from "@/lib/order-mutations";

export const dynamic = "force-dynamic";
export function POST(request: Request) { return runOrderMutation(request, "revoke-ticket"); }
