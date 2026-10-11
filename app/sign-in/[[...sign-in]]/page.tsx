import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <section aria-label="Iniciar sesión" className="flex min-h-[75dvh] items-center justify-center px-4 py-10">
      <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" forceRedirectUrl="/account" />
    </section>
  );
}
