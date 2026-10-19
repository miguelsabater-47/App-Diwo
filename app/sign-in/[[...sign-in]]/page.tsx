import { LoginScreen } from "@/components/login-screen";
import { PasswordRecoveryScreen } from "@/components/password-recovery-screen";

export default async function SignInPage({ params }: { params: Promise<{ "sign-in"?: string[] }> }) {
  const parts = (await params)["sign-in"] ?? [];
  if (parts.length === 1 && parts[0] === "recover") return <PasswordRecoveryScreen />;
  const nativePath = parts.length === 0 ? null : parts[0] === "clerk" ? "/sign-in/clerk" : "/sign-in";
  return <LoginScreen nativePath={nativePath} />;
}
