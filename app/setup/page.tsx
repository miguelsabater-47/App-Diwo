import { redirect } from "next/navigation";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { LocalSetupNotice } from "@/components/local-setup-notice";

export default function SetupPage() {
  if (hasDevelopmentClerkKeys(process.env)) redirect("/");
  return <LocalSetupNotice />;
}
