"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AccountEmail() {
  const { user, isLoaded } = useUser();
  return <p className="ml-auto min-w-0 max-w-full rounded-xl border border-zinc-700 bg-card px-3 py-2 text-right text-sm text-zinc-200 break-all sm:max-w-[65%]">
    <span className="sr-only">Correo de la cuenta: </span>
    {isLoaded ? user?.primaryEmailAddress?.emailAddress || "Correo no disponible" : "Cargando cuenta…"}
  </p>;
}

export function AccountActions() {
  return (
    <div className="flex flex-col gap-4">
      <SignOutButton redirectUrl="/sign-in"><Button variant="outline" className="diwo-account-signout">Cerrar sesión</Button></SignOutButton>
    </div>
  );
}
