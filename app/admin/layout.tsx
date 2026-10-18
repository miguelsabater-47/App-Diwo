import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!hasConfiguredClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const access = await requireAdminAccess();
  if (!access.ok) {
    if (access.status === 401) redirect("/sign-in");
    if (access.status === 403) notFound();
    return <section role="alert" className="mx-auto max-w-xl px-5 py-10 text-zinc-300">No hemos podido verificar tus permisos. Actualiza la página.</section>;
  }
  // Single role-aware navigation is rendered by the app shell, not a second bar.
  return <>{children}</>;
}
