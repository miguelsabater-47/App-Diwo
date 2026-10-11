"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AccountActions() {
  const { user, isLoaded } = useUser();
  return (
    <div className="flex flex-col gap-4">
      <p className="break-all text-zinc-300">{isLoaded ? user?.primaryEmailAddress?.emailAddress : "Cargando cuenta…"}</p>
      <SignOutButton redirectUrl="/"><Button>Cerrar sesión</Button></SignOutButton>
    </div>
  );
}
