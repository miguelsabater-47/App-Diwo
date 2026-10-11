"use client";

import Image from "next/image";
import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavButton } from "@/components/nav-button";
import logo from "@/app/assets/logo.png";

export default function AuthHeader() {
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
            width={logo.width}
            height={logo.height}
            style={{ width: 56, height: "auto" }}
            loading="eager"
            fetchPriority="low"
            unoptimized
          />
        </Link>

        <nav aria-label="Acceso a la cuenta" className="flex items-center gap-2">
          <SignedOut>
              <Button asChild size="sm" className="gap-2 font-semibold">
                <Link href="/sign-in">
                <LogIn className="h-4 w-4" />
                Iniciar sesión
                </Link>
              </Button>
          </SignedOut>

          <SignedIn>
            <NavButton href="/account">Mi cuenta</NavButton>
            <UserButton />
          </SignedIn>
        </nav>
      </div>
    </header>
  );
}
