"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";

export default function AuthHeader() {
  const pathname = usePathname();
  const { user } = useUser();
  const title = pathname === "/" ? "INICIO" : pathname === "/account" ? "MI CUENTA"
    : pathname.startsWith("/ticket") ? "MIS ENTRADAS" : pathname === "/request" ? "ENTRADAS" : "DIWO CLUB";
  const initial = user?.firstName?.trim().charAt(0).toLocaleUpperCase("es") || "D";
  return (
    <header className="diwo-app-header">
      <Link href="/" className="diwo-app-brand" aria-label="Ir a inicio">
        <Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={56} height={30} priority />
        <span>{title}</span>
      </Link>
      <Link href="/account" className="diwo-app-avatar" aria-label="Mi cuenta" aria-current={pathname === "/account" ? "page" : undefined}>
        {user?.hasImage && user.imageUrl
          ? <Image src={user.imageUrl} alt="" width={40} height={40} unoptimized />
          : <span aria-hidden="true">{initial}</span>}
      </Link>
    </header>
  );
}
