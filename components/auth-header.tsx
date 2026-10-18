"use client";

import Image from "next/image";
import { BuyerFlowLink as Link } from "@/components/buyer-flow-link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";

export default function AuthHeader() {
  const pathname = usePathname();
  const paymentPage = pathname.startsWith("/ticket/payment/");
  const ticketDetail = pathname === "/ticket/design" || /^\/ticket\/[0-9a-f-]{36}\/?$/i.test(pathname);
  const { user } = useUser();
  const adminTitle = ({ "/admin": "Resumen", "/admin/requests": "Solicitudes", "/admin/scan": "Escáner", "/admin/tickets": "Entradas", "/admin/staff": "Personal" } as Record<string, string>)[pathname.replace(/\/$/, "")];
  const title = adminTitle ?? (paymentPage ? "Instrucciones de pago" : ticketDetail ? "Mis entradas" : pathname === "/" ? "INICIO" : pathname === "/account" ? "MI CUENTA"
    : pathname.startsWith("/ticket") ? "MIS ENTRADAS" : pathname === "/request" ? "Conseguir entradas" : "DIWO CLUB");
  const initial = user?.firstName?.trim().charAt(0).toLocaleUpperCase("es") || "D";
  const logo = <Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={56} height={30} priority />;
  return (
    <header className="diwo-app-header">
      {paymentPage || ticketDetail ? <Link href={pathname.replace(/\/$/, "") === "/ticket/payment/preview" ? "/ticket/preview" : "/ticket"} className="diwo-request-back" aria-label="Volver a Mis entradas"><ArrowLeft aria-hidden="true" /></Link> : <Link href="/" className="diwo-app-brand" aria-label="Ir a inicio">{logo}</Link>}
      <span className="diwo-app-header-title">{title}</span>
      <Link href="/account" className="diwo-app-avatar" aria-label="Mi cuenta" aria-current={pathname === "/account" ? "page" : undefined}>
        {user?.hasImage && user.imageUrl
          ? <Image src={user.imageUrl} alt="" width={40} height={40} unoptimized />
          : <span aria-hidden="true">{initial}</span>}
      </Link>
    </header>
  );
}
