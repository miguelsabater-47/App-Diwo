import { LoginScreen } from "@/components/login-screen";

export default async function SignInPage({ params }: { params: Promise<{ "sign-in"?: string[] }> }) {
  const parts = (await params)["sign-in"] ?? [];
  const nativePath = parts.length === 0 ? null : parts[0] === "clerk" ? "/sign-in/clerk" : "/sign-in";
  return <LoginScreen nativePath={nativePath} />;
}
