"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  href: string;
  children: React.ReactNode;
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
  exact?: boolean;
};

export function NavButton({ href, children, size = "sm", className, exact = false }: Props) {
  const pathname = usePathname();
  const isActive =
    pathname === href || (!exact && href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <Button
      asChild
      size={size}
      variant={isActive ? "default" : "secondary"}
      aria-current={isActive ? "page" : undefined}
      className={className}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}
