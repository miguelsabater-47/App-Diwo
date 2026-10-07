"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { CodeInput } from "@/components/code-input";

export default function Home() {
  const { isSignedIn } = useUser();
  const { openSignIn } = useClerk();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (value: string) => {
    if (!value || value.length !== 6 || isSubmitting) return;
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "code_not_found")
          toast.error("Código no encontrado");
        else if (data.error === "code_already_redeemed")
          toast.warning("Código ya canjeado");
        else if (data.error === "user_already_has_ticket")
          toast.info("Ya tienes una entrada");
        else if (data.error === "invalid_code") toast.error("Código inválido");
        else toast.error("Error del servidor");
        return;
      }
      toast.success("🎉 Código canjeado correctamente");
    } catch {
      toast.error("Error de red o del servidor");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="relative grid place-items-center overflow-hidden p-4 h-full min-h-[calc(100dvh-56px-env(safe-area-inset-bottom))]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(234,179,8,0.1),transparent_50%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(234,179,8,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(234,179,8,0.05)_1px,transparent_1px)] bg-[size:4rem_4rem]" />

      <div className="relative z-10 mx-auto w-full max-w-2xl flex flex-col gap-8 px-2">
        <div className="text-center space-y-4">
          <h1 className="text-5xl md:text-7xl font-bold text-balance">
            Canjea tu entrada
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground text-balance">
            Introduce tu código para canjear tu entrada
          </p>
        </div>

        <CodeInput
          length={6}
          disabled={isSubmitting}
          isSubmitting={isSubmitting}
          isSignedIn={!!isSignedIn}
          onComplete={setCode}
          onSubmit={handleSubmit}
          submitLabel="Enviar Código"
          showSignInHint
        />
      </div>
    </section>
  );
}
