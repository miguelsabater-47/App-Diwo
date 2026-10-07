"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AdminGiveCode() {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const getNext = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/next-code", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "no_available_codes")
          return toast.warning("No hay códigos disponibles");
        return toast.error("Error obteniendo código");
      }
      setPreview(data.code as string);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!preview || confirming) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: preview }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "code_unavailable") {
          toast.info("Ese código ya no está disponible. Obteniendo otro…");
          setPreview(null);
          await getNext();
        } else {
          toast.error("No se pudo asignar el código");
        }
        return;
      }
      toast.success(`Código asignado: ${data.code}`);
      setPreview(null);
    } finally {
      setConfirming(false);
    }
  };

  const cancel = () => setPreview(null);

  return (
    <div className="space-y-4">
      {!preview ? (
        <Button
          onClick={getNext}
          disabled={loading}
          className="min-w-[10rem] whitespace-nowrap"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Buscando…
            </>
          ) : (
            "Dar código"
          )}
        </Button>
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Código a la izquierda */}
            <div className="min-w-[12rem]">
              <div className="text-xs text-muted-foreground">
                Código para entregar
              </div>
              <div className="font-mono text-2xl font-bold tracking-wider">
                {preview}
              </div>
            </div>

            {/* Botonera a la derecha (mismo tamaño) */}
            <div className="flex gap-2 flex-wrap justify-end">
              <Button
                variant="secondary"
                onClick={cancel}
                disabled={confirming}
                size="sm"
                className="h-10 w-36 whitespace-nowrap"
              >
                Cancelar
              </Button>
              <Button
                onClick={confirm}
                disabled={confirming}
                size="sm"
                className="h-10 w-36 whitespace-nowrap"
              >
                {confirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirmando…
                  </>
                ) : (
                  "Confirmar"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
