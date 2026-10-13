"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefreshOrders() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button type="button" variant="secondary" className="min-h-11" disabled={pending}
    onClick={() => start(() => router.refresh())}><RefreshCw aria-hidden="true" />{pending ? "Actualizando…" : "Actualizar"}</Button>;
}
