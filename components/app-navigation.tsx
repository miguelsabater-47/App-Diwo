"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Ticket, UserRound } from "lucide-react";

export function AppNavigation() {
  const pathname = usePathname();
  if (!["/", "/account", "/ticket", "/request"].includes(pathname)) return null;
  const items = [
    { href: "/", label: "Inicio", icon: Home, active: pathname === "/" },
    { href: "/ticket", label: "Mis entradas", icon: Ticket, active: ["/ticket", "/request"].includes(pathname) },
    { href: "/account", label: "Mi cuenta", icon: UserRound, active: pathname === "/account" },
  ];
  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid w-full max-w-xl grid-cols-3 px-3 py-2">
        {items.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "bg-primary/10 text-primary" : "text-zinc-400 hover:text-white"}`}>
          <Icon aria-hidden="true" className="size-5" /><span>{label}</span>
        </Link>)}
      </div>
    </nav>
  );
}
