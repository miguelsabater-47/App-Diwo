"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AccountIdentity() {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return <p role="status" className="diwo-account-loading">Cargando cuenta…</p>;
  const name = user?.fullName?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return <dl className="diwo-account-identity">
    <div><dt>Nombre</dt><dd>{name || "Nombre no disponible"}</dd></div>
    <div><dt>Correo electrónico</dt><dd>{user?.primaryEmailAddress?.emailAddress || "Correo no disponible"}</dd></div>
  </dl>;
}

export function AccountActions() {
  return (
    <div className="diwo-account-actions">
      <SignOutButton redirectUrl="/sign-in"><Button className="diwo-account-signout">Cerrar sesión</Button></SignOutButton>
    </div>
  );
}
