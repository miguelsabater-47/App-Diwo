import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import "./sign-up.css";

export default function SignUpPage() {
  return (
    <section aria-label="Crear cuenta" className="diwo-sign-up flex min-h-[75dvh] flex-col items-center justify-center gap-4 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm text-white hover:text-[#FCE921] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FCE921]">
          <ArrowLeft aria-hidden="true" className="size-5" />Volver
        </Link>
      </div>
      <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" forceRedirectUrl="/account"
        appearance={{
          variables: {
            colorPrimary: "#FCE921",
            colorTextOnPrimaryBackground: "#000000",
            colorBackground: "#000000",
            colorText: "#FFFFFF",
            colorTextSecondary: "#999999",
            colorInputBackground: "#000000",
            colorInputText: "#FFFFFF",
            colorNeutral: "#FFFFFF",
            fontFamily: "Satoshi, Arial, sans-serif",
          },
          elements: {
            cardBox: { backgroundColor: "#000000", boxShadow: "none" },
            card: { backgroundColor: "#000000", boxShadow: "none" },
            headerTitle: { color: "#FFFFFF" },
            headerSubtitle: { color: "#999999" },
            formFieldLabel: { color: "#FFFFFF" },
            formFieldInput: {
              backgroundColor: "#000000", color: "#FFFFFF", borderColor: "#666666",
              "&:focus": { borderColor: "#FCE921", boxShadow: "none" },
            },
            formFieldAction: { color: "#FCE921" },
            formFieldInputShowPasswordButton: { color: "#999999" },
            dividerLine: { backgroundColor: "#525252" },
            dividerText: { color: "#999999" },
            socialButtonsBlockButton: {
              backgroundColor: "#FFFFFF", color: "#1D1E1C", borderColor: "#FFFFFF",
              "&:hover": { backgroundColor: "#E5E5E5" },
            },
            socialButtonsBlockButtonText: { color: "#1D1E1C" },
            footer: { backgroundColor: "#000000", backgroundImage: "none" },
            footerActionText: { color: "#FFFFFF" },
            footerActionLink: { color: "#FCE921" },
          },
        }} />
    </section>
  );
}
