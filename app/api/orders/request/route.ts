import { runOrderMutation } from "@/lib/order-mutations";

export async function POST(request: Request) {
  return runOrderMutation(request, "request");
}
