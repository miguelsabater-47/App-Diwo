import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import "./sign-up.css";

export default function SignUpPage() {
  return (
    <section aria-label="Crear cuenta" className="diwo-sign-up">
      <div className="w-full">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center gap-2 rounded text-base text-white hover:text-[#FCE921] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FCE921]">
          <ArrowLeft aria-hidden="true" className="size-5" />Volver
        </Link>
      </div>
      <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" forceRedirectUrl="/"
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
            rootBox: { width: "100%", minWidth: "0", maxWidth: "100%" },
            cardBox: { width: "100%", minWidth: "0", maxWidth: "100%", backgroundColor: "#000000", boxShadow: "none" },
            card: { width: "100%", minWidth: "0", padding: "0", gap: "24px", backgroundColor: "#000000", boxShadow: "none" },
            headerTitle: { color: "#FFFFFF", fontSize: "20px", lineHeight: "1.3", textAlign: "left" },
            headerSubtitle: { color: "#999999", fontSize: "14px", lineHeight: "1.45", textAlign: "left" },
            formFieldLabel: { color: "#FFFFFF", fontSize: "16px", lineHeight: "1.4" },
            formFieldInput: {
              backgroundColor: "#000000", color: "#FFFFFF", borderColor: "#666666",
              width: "100%", minWidth: "0", minHeight: "var(--diwo-auth-control-height)",
              fontSize: "var(--diwo-auth-input-size)", lineHeight: "1.4", padding: "12px 16px", borderRadius: "11px",
              "&:focus": { borderColor: "#FCE921", boxShadow: "none" },
            },
            formFieldAction: { color: "#FCE921" },
            formFieldInputShowPasswordButton: { color: "#999999" },
            dividerLine: { backgroundColor: "#525252" },
            dividerText: { color: "#999999" },
            socialButtonsBlockButton: {
              backgroundColor: "#FFFFFF", color: "#1D1E1C", borderColor: "#FFFFFF",
              minHeight: "var(--diwo-auth-control-height)", fontSize: "var(--diwo-auth-input-size)",
              padding: "12px 16px", borderRadius: "11px",
              "&:hover": { backgroundColor: "#E5E5E5" },
            },
            socialButtonsBlockButtonText: { color: "#1D1E1C", fontSize: "16px", fontWeight: "700" },
            socialButtonsProviderIcon: { width: "24px", height: "24px" },
            formButtonPrimary: {
              minHeight: "var(--diwo-auth-control-height)", fontSize: "var(--diwo-auth-input-size)",
              padding: "12px 16px", borderRadius: "11px", fontWeight: "700",
            },
            footer: { backgroundColor: "#000000", backgroundImage: "none", padding: "24px 0" },
            footerActionText: { color: "#FFFFFF" },
            footerActionLink: { color: "#FCE921" },
          },
        }} />
    </section>
  );
}
