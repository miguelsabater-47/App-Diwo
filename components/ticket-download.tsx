"use client";

import { useRef, useState } from "react";
import { toPng, toJpeg } from "html-to-image";
import { Button } from "@/components/ui/button";
import { EventTicket } from "@/components/event-ticket";

type Props = { name: string; email: string; code: string };

export function TicketDownload({ name, email, code }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  const waitForFonts = async () => {
    try {
      if (document.fonts && "ready" in document.fonts) {
        await document.fonts.ready;
      }
    } catch {
      /* ignore */
    }
  };

  const exportImage = async (fmt: "png" | "jpg") => {
    if (!ref.current || busy) return;
    setBusy(true);
    try {
      await waitForFonts();

      const baseOpts: Parameters<typeof toPng>[1] = {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#000000",
      };

      const dataUrl =
        fmt === "png"
          ? await toPng(ref.current, baseOpts)
          : await toJpeg(ref.current, {
              ...baseOpts,
              quality: 0.95,
            } as Parameters<typeof toJpeg>[1]);

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `ticket-${code}.${fmt === "png" ? "png" : "jpg"}`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div ref={ref}>
        <EventTicket name={name} email={email} code={code} />
      </div>

      <div>
        <Button
          onClick={() => exportImage("jpg")}
          disabled={busy}
          className="w-full "
        >
          Descargar Entrada
        </Button>
      </div>
    </div>
  );
}
