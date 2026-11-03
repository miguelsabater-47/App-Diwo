import { auth, clerkClient, reverificationErrorResponse } from "@clerk/nextjs/server";
import { handleAccountDeletion } from "@/lib/account-deletion-core";
import { getCurrentAppAccess } from "@/lib/app-authorization";
import { configuredAppOrigin } from "@/lib/local-access";

export async function DELETE(request: Request) {
  return handleAccountDeletion(request, {
    origin: configuredAppOrigin(process.env),
    authenticate: async () => {
      const session = await auth();
      return { userId: session.userId, reverified: session.has({ reverification: "strict" }) };
    },
    access: getCurrentAppAccess,
    reverificationRequired: () => {
      const response = reverificationErrorResponse("strict");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
    deleteUser: async userId => (await clerkClient()).users.deleteUser(userId),
  });
}
