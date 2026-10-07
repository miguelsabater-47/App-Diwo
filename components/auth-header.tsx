"use client";

import Image from "next/image";
import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavButton } from "@/components/nav-button";
import logo from "@/app/assets/logo.png";

export default function AuthHeader() {
  const { user } = useUser();
  const isAdminUI =
    user?.publicMetadata?.isAdmin === true ||
    user?.publicMetadata?.role === "admin";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="Ir a inicio"
        >
          <Image
            src={logo}
            alt="Diwo"
            width={56}
            height={56}
            priority
            unoptimized
          />
        </Link>

        <nav className="flex items-center gap-2">
          <SignedOut>
            <SignInButton mode="modal">
              <Button size="sm" className="gap-2 font-semibold">
                <LogIn className="h-4 w-4" />
                Iniciar sesión
              </Button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <NavButton href="/ticket">Mi Entrada</NavButton>
            {isAdminUI && <NavButton href="/admin">Admin</NavButton>}
            <UserButton />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
