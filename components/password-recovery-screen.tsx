"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { ArrowLeft, Eye, EyeOff, Mail } from "lucide-react";
import { loginEmail } from "@/lib/login-flow";
import { recoveryError } from "@/lib/password-recovery";

export function PasswordRecoveryScreen() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const [step, setStep] = useState<"email" | "reset" | "continue">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const redirecting = useRef(false);
  const attemptId = useRef<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const ready = isLoaded && authLoaded;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (authLoaded && isSignedIn && !busy && step !== "continue" && !redirecting.current) {
      redirecting.current = true;
      window.location.replace("/");
    }
  }, [authLoaded, isSignedIn, busy, step]);

  async function run(operation: () => Promise<void>) {
    if (!ready || isSignedIn || !signIn || !setActive || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await operation(); }
    catch (failure) { if (mounted.current) setError(recoveryError(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const identifier = loginEmail(email);
    if (!identifier) { setError("Introduce un correo electrónico válido."); return; }
    void run(async () => {
      if (!signIn) return;
      // Core 2: create both starts the reset attempt and asks Clerk to send its code.
      const result = await signIn.create({ strategy: "reset_password_email_code", identifier });
      if (!mounted.current) return;
      if (result.status !== "needs_first_factor" || !result.id) throw new Error("unexpected_recovery_status");
      attemptId.current = result.id;
      if (codeInput.current) codeInput.current.value = "";
      setEmail(identifier); setStep("reset");
    });
  }

  function reset(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const code = codeInput.current?.value.trim() ?? "";
    const password = passwordInput.current?.value ?? "";
    if (!code) { setError("Introduce el código que has recibido por correo."); codeInput.current?.focus(); return; }
    if (!password) { setError("Introduce tu nueva contraseña."); passwordInput.current?.focus(); return; }
    void run(async () => {
      if (!signIn || !setActive) return;
      if (!attemptId.current || signIn.id !== attemptId.current) throw { code: "verification_expired" };
      const result = await signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code, password });
      if (!mounted.current) return;
      if (!["complete", "needs_second_factor", "needs_client_trust", "needs_new_password"].includes(result.status ?? "")) {
        throw new Error("unexpected_recovery_status");
      }
      if (result.status === "complete" && !result.createdSessionId) throw new Error("missing_completed_session");
      if (passwordInput.current) passwordInput.current.value = "";
      if (codeInput.current) codeInput.current.value = "";
      setVisible(false); setStep("continue");
      if (result.status !== "complete") {
        window.location.assign("/sign-in/clerk");
        return;
      }
      let hasTasks = false;
      await setActive({ session: result.createdSessionId, navigate: async ({ session }) => { hasTasks = !!session?.currentTask; } });
      if (mounted.current && !redirecting.current) {
        redirecting.current = true;
        // Fresh document only AFTER activation; native Clerk still owns pending tasks.
        window.location.replace(hasTasks ? "/sign-in/clerk" : "/");
      }
    });
  }

  function changeEmail() {
    if (inFlight.current) return;
    attemptId.current = null;
    if (passwordInput.current) passwordInput.current.value = "";
    if (codeInput.current) codeInput.current.value = "";
    setVisible(false); setError(null); setStep("email");
  }

  const disabled = busy || !ready || !!isSignedIn;
  if (authLoaded && isSignedIn && step !== "continue") return <section className="diwo-native-auth"><p role="status">Abriendo Inicio…</p></section>;
  return <section className="diwo-login diwo-recovery" aria-label="Recuperar contraseña">
    <Link href="/sign-in" aria-label="Volver al acceso" className="diwo-login-back"><ArrowLeft aria-hidden="true" size={22} /></Link>
    <Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={454} height={236} priority className="diwo-login-logo" />
    <header className="diwo-login-intro"><h1>{step === "email" ? "Recupera tu contraseña" : step === "reset" ? "Crea una nueva contraseña" : "Continúa el acceso seguro"}</h1>
      <p>{step === "email" ? "Introduce tu correo y te enviaremos un código para cambiarla." : step === "reset" ? `Introduce el código enviado a ${email} y elige tu nueva contraseña. Revisa también el correo no deseado.` : "Completa las comprobaciones de seguridad para acceder a tu cuenta."}</p>
    </header>
    {step === "email" && <form onSubmit={sendCode} noValidate aria-busy={busy}>
      <div className="diwo-login-field"><label htmlFor="diwo-recovery-email" className="sr-only">Correo electrónico</label>
        <input id="diwo-recovery-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="Correo electrónico" value={email} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? "diwo-recovery-error" : undefined} onChange={event => { setEmail(event.target.value); setError(null); }} />
        <Mail aria-hidden="true" size={22} />
      </div>
      <button type="submit" className="diwo-login-primary" disabled={disabled}>{busy ? "ENVIANDO…" : "ENVIAR CÓDIGO"}</button>
    </form>}
    {step === "reset" && <>
      <form onSubmit={reset} noValidate aria-busy={busy}>
        <label htmlFor="diwo-recovery-code" className="diwo-recovery-label">Código del correo</label>
        <div className="diwo-login-field"><input ref={codeInput} id="diwo-recovery-code" name="code" type="text" autoComplete="one-time-code" placeholder="Código de verificación" disabled={disabled} aria-invalid={!!error} aria-describedby={error ? "diwo-recovery-error" : undefined} /></div>
        <label htmlFor="diwo-recovery-password" className="diwo-recovery-label">Nueva contraseña</label>
        <div className="diwo-login-field"><input ref={passwordInput} id="diwo-recovery-password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" placeholder="Nueva contraseña" disabled={disabled} aria-invalid={!!error} aria-describedby={error ? "diwo-recovery-error" : undefined} />
          <button type="button" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible} aria-controls="diwo-recovery-password" onClick={() => setVisible(value => !value)}>{visible ? <EyeOff aria-hidden="true" size={22} /> : <Eye aria-hidden="true" size={22} />}</button>
        </div>
        <button type="submit" className="diwo-login-primary" disabled={disabled}>{busy ? "COMPROBANDO…" : "GUARDAR CONTRASEÑA"}</button>
      </form>
      <div className="diwo-recovery-actions"><button type="button" className="diwo-auth-link" disabled={disabled} onClick={() => sendCode()}>Reenviar código</button><button type="button" className="diwo-auth-link" disabled={busy} onClick={changeEmail}>Cambiar correo</button></div>
    </>}
    {step === "continue" && <Link href="/sign-in/clerk" className="diwo-auth-link diwo-native-back">Continuar el acceso seguro</Link>}
    {!ready && <p role="status" className="diwo-login-status">Cargando acceso seguro…</p>}
    {error && <p role="alert" id="diwo-recovery-error" className="diwo-login-error">{error}</p>}
  </section>;
}
