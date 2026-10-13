import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { readOwnedTicket } from "@/lib/owned-ticket-reader";
import { OwnedTicketDetail } from "@/components/owned-ticket-detail";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDevelopmentClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const result = await readOwnedTicket(id);
  if (!result.ok && result.status === 404) notFound();
  return <OwnedTicketDetail result={result} />;
}
