export function LocalSetupNotice() {
  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary">DIWO X 2.0 · Desarrollo local</p>
      <h1 className="text-3xl font-bold text-white">Conectar tu cuenta de Clerk</h1>
      <p className="text-zinc-300">
        Introduce las dos claves de tu instancia Development en el archivo privado
        <code className="mx-1 rounded bg-secondary px-2 py-1">web/.env.local</code>
        y reinicia el servidor local.
      </p>
      <p className="text-sm text-zinc-400">No compartas las claves en el chat. La guía está en setup/LOCAL-DEVELOPMENT.md.</p>
      <p className="text-sm text-zinc-400">Esta pantalla no crea otra aplicación de Clerk ni solicita claves de Supabase.</p>
    </section>
  );
}
