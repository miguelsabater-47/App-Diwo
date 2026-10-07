import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AdminGiveCode from "@/components/admin-give-code";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/admin");
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const priv = user.privateMetadata ?? {};
  const isAdmin =
    priv.isAdmin === true || priv.isAdmin === "true" || priv.role === "admin";
  if (!isAdmin) redirect("/403");

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-3xl font-bold">Dar código</h1>
      <p className="text-sm text-muted-foreground">
        Pulsa “Dar código” para obtener el siguiente disponible. Revisa y
        confirma para marcarlo como emitido.
      </p>
      <AdminGiveCode />
    </main>
  );
}
