import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <section aria-label="Crear cuenta" className="flex min-h-[75dvh] items-center justify-center px-4 py-10">
      <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" forceRedirectUrl="/account" />
    </section>
  );
}
