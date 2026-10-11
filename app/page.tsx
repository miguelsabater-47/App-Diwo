import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Temporary auth bootstrap, not the final public/admin Home design. */
export default function Home() {
  return (
    <section className="mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">Prueba local de acceso</p>
      <h1 className="text-4xl font-bold text-white">DIWO X 2.0</h1>
      <p className="text-zinc-300">Inicia sesión con tu cuenta para comprobar la conexión de esta web con Clerk.</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg"><Link href="/account">Ir a mi cuenta</Link></Button>
        <Button asChild size="lg" variant="secondary"><Link href="/sign-up">Crear cuenta</Link></Button>
      </div>
      <p className="text-sm text-zinc-400">Las solicitudes y entradas se activarán en el siguiente bloque. El canje antiguo de códigos está deshabilitado.</p>
    </section>
  );
}
