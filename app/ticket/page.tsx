import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { TicketDownload } from "@/components/ticket-download";

export default async function TicketPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/ticket");

  const { data, error } = await supabaseServer
    .from("tickets")
    .select("code, email, full_name")
    .eq("clerk_id", userId)
    .single();

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-2xl font-bold">No ticket found</h2>
          <p className="text-muted-foreground">
            Redeem your code to generate your ticket.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <TicketDownload
        name={data.full_name}
        email={data.email}
        code={data.code}
      />
    </div>
  );
}
