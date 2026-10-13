"use client";

import { SignOutButton, useClerk, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AccountActions() {
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  return (
    <div className="flex flex-col gap-4">
      <p className="break-all text-zinc-300">{isLoaded ? user?.primaryEmailAddress?.emailAddress : "Cargando cuenta…"}</p>
      <Button type="button" variant="secondary" className="min-h-12" disabled={!isLoaded || !user} onClick={() => clerk.openUserProfile()}>Mi perfil</Button>
      <Button type="button" variant="secondary" className="min-h-12" disabled={!isLoaded || !user} onClick={() => clerk.openUserProfile()}>Configuración de cuenta</Button>
      <SignOutButton redirectUrl="/"><Button className="min-h-12">Cerrar sesión</Button></SignOutButton>
    </div>
  );
}
