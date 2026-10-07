"use client";

import { useMemo } from "react";
import { Ticket, User, Mail, Hash } from "lucide-react";

type EventTicketProps = {
  name: string;
  email: string;
  code: string;
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stringToSeed(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function EventTicket({ name, email, code }: EventTicketProps) {
  const bars = useMemo(() => {
    const rng = mulberry32(stringToSeed(`${code}:${email}`));
    // Generamos altura máxima (var(--bar-height)), duración y delay de forma determinista
    return Array.from({ length: 24 }, () => {
      const maxHeight = 60 + rng() * 40; // 60%..100%
      const duration = 1.2 + rng() * 1.2; // 1.2s..2.4s => más lento, “ecualizador”
      const delay = rng() * 0.6; // 0..0.6s
      const opacity = 0.7 + rng() * 0.3; // 0.7..1
      return { maxHeight, duration, delay, opacity };
    });
  }, [code, email]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div className="absolute -inset-1 bg-primary/20 rounded-2xl blur-xl animate-pulse" />
      <div className="relative bg-card border-2 border-primary/50 rounded-2xl overflow-hidden shadow-2xl shadow-primary/20">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_48%,var(--primary)_49%,var(--primary)_51%,transparent_52%)] bg-[length:20px_20px]" />
        </div>

        <div className="relative border-b-2 border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-lg border border-primary/50">
                <Ticket className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-primary tracking-wider">
                  DIWO CLUB
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  MUSICA URBANA
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground font-mono">
                ADMITIDO
              </div>
              <div className="text-sm font-bold text-primary">SI</div>
            </div>
          </div>
        </div>

        <div className="relative p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
              <User className="w-3 h-3" />
              <span>ALIAS</span>
            </div>
            <div className="text-lg font-bold text-foreground truncate">
              {name}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
              <Mail className="w-3 h-3" />
              <span>MAIL</span>
            </div>
            <div className="text-sm text-foreground/80 truncate font-mono">
              {email}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
              <Hash className="w-3 h-3" />
              <span>CÓDIGO DE ACCESO</span>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-primary/10 rounded-lg blur-md" />
              <div className="relative bg-black/50 border-2 border-primary rounded-lg p-4 backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary tracking-[0.5em] font-mono drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">
                    {code}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-primary/20">
            <div className="flex justify-center gap-1 h-16 items-end px-4">
              {bars.map((b, i) => {
                // Tipado ESTRICTO de CSS vars (sin any):
                type CSSVars = React.CSSProperties &
                  Record<"--bar-height", string>;
                const style: CSSVars = {
                  opacity: b.opacity,
                  animationName: "musicBar",
                  animationDuration: `${b.duration}s`,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                  animationDelay: `${b.delay}s`,
                  minHeight: "15%",
                  ["--bar-height"]: `${b.maxHeight}%`,
                };
                return (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-primary to-primary/60 rounded-t-md shadow-[0_0_8px_rgba(234,179,8,0.35)] origin-bottom will-change-[height,transform]"
                    style={style}
                  />
                );
              })}
            </div>
            <div className="text-center mt-3 text-xs text-muted-foreground font-mono tracking-wider">
              MOSTRAR EN PUERTA
            </div>
          </div>
        </div>

        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2">
          <div className="w-4 h-4 rounded-full bg-background border-2 border-primary/30" />
        </div>
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2">
          <div className="w-4 h-4 rounded-full bg-background border-2 border-primary/30" />
        </div>
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] border-t-2 border-dashed border-primary/20" />
      </div>

      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
        <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent animate-[scan_3s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
