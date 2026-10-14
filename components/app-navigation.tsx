"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Ticket } from "lucide-react";

export function AppNavigation() {
  const pathname = usePathname();
  if (!["/", "/account", "/ticket", "/request"].includes(pathname)) return null;
  const items = [
    { href: "/", label: "Inicio", icon: Home, active: pathname === "/" },
    { href: "/ticket", label: "Mis entradas", icon: Ticket, active: ["/ticket", "/request"].includes(pathname) },
  ];
  return (
    <nav aria-label="Navegación principal" className="diwo-app-navigation">
      <div className="diwo-app-navigation-items">
        {items.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href}
          aria-current={active ? "page" : undefined}
          className={`diwo-app-tab ${active ? "diwo-app-tab-active" : ""}`}>
          <Icon aria-hidden="true" className="size-5" /><span>{label}</span>
        </Link>)}
      </div>
    </nav>
  );
}
