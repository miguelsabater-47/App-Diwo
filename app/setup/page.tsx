import { redirect } from "next/navigation";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { LocalSetupNotice } from "@/components/local-setup-notice";

export default function SetupPage() {
  if (hasConfiguredClerkKeys(process.env)) redirect("/");
  return <LocalSetupNotice />;
}
