import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return <section className="diwo-native-auth" aria-label="Completando acceso con Google">
    <p role="status">Completando acceso seguro…</p>
    <AuthenticateWithRedirectCallback signInUrl="/sign-in/clerk" signUpUrl="/sign-up" signInForceRedirectUrl="/" signUpForceRedirectUrl="/" />
  </section>;
}
