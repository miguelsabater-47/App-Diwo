"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CodeInputProps = {
  length?: number;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  isSubmitting?: boolean;
  isSignedIn?: boolean;
  onSubmit?: (code: string) => void;
  submitLabel?: string;
  showSignInHint?: boolean;
};

export function CodeInput({
  length = 6,
  onComplete,
  disabled = false,
  autoFocus = true,
  isSubmitting = false,
  isSignedIn = true,
  onSubmit,
  submitLabel = "Enviar Código",
  showSignInHint = true,
}: CodeInputProps) {
  const [value, setValue] = useState("");
  const boxes = useMemo(() => {
    const v = value.toUpperCase().slice(0, length);
    return Array.from({ length }, (_, i) => v[i] ?? "");
  }, [value, length]);

  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const submitDisabled = disabled || isSubmitting || value.length !== length;

  useEffect(() => {
    if (autoFocus && hiddenRef.current) {
      hiddenRef.current.focus();
      const el = hiddenRef.current;
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(value.length, value.length);
        } catch {}
      });
    }
  }, [autoFocus, value.length]);

  const sanitize = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const handleInput = (raw: string) => {
    const next = sanitize(raw).slice(0, length);
    setValue(next);
    if (next.length === length) onComplete?.(next);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const text = e.clipboardData.getData("text");
    handleInput(value + text);
    e.preventDefault();
  };

  const focusHidden = () => {
    hiddenRef.current?.focus();
    const el = hiddenRef.current;
    if (el) {
      try {
        el.setSelectionRange(value.length, value.length);
      } catch {}
    }
  };

  const handleSubmit = () => {
    if (!submitDisabled) onSubmit?.(value);
  };

  return (
    <div className="w-full bg-card border-2 border-border rounded-2xl p-6 md:p-10 shadow-2xl shadow-primary/10 overflow-x-hidden">
      <div className="space-y-8">
        <div className="relative">
          <input
            ref={hiddenRef}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            aria-label="Código"
            className="absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none"
            disabled={disabled}
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            onPaste={handlePaste}
          />

          <div
            role="group"
            aria-label="Ingresar código"
            onClick={focusHidden}
            className="mx-auto w-full max-w-[min(92vw,560px)] grid grid-cols-6 gap-2 sm:gap-3"
          >
            {boxes.map((ch, i) => {
              const filled = ch !== "";
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-center w-full select-none",
                    "rounded-lg border-2 box-border bg-card",
                    "h-20 sm:h-24 px-2",
                    "font-mono font-bold tabular-nums text-3xl sm:text-4xl leading-none",
                    "border-border",
                    filled && "border-primary bg-card/80",
                    disabled && "opacity-50"
                  )}
                >
                  <span className="translate-y-[1px]">{ch}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            onClick={handleSubmit}
            disabled={submitDisabled}
            size="lg"
            className="w-full text-lg font-semibold h-14 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSubmitting ? "Enviando..." : submitLabel}
          </Button>
          {showSignInHint && !isSignedIn && (
            <p className="text-sm text-center text-muted-foreground">
              Regístrate para canjear tu entrada
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
