import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return <section role="status" aria-live="polite" className="mx-auto flex min-h-[40dvh] w-full max-w-3xl items-center justify-center gap-3 px-6 py-12 text-zinc-300">
    <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin text-[#FCE921]" />
    <p>Cargando pantalla…</p>
  </section>;
}
