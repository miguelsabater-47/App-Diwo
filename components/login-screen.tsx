"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignIn, useAuth, useSignIn } from "@clerk/nextjs";
import { ArrowLeft, Mail, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { loginEmail, loginError, passwordSignIn } from "@/lib/login-flow";

export function LoginScreen({ nativePath = null }: { nativePath?: string | null }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const focusEmail = useRef(false);
  const redirecting = useRef(false);
  const ready = isLoaded && authLoaded;

  const goHome = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    // A fresh document reads the activated session without racing an RSC refresh.
    window.location.replace("/");
  }, []);

  function resetPasswordStep() {
    generation.current++;
    focusEmail.current = true;
    if (passwordInput.current) passwordInput.current.value = "";
    setVisible(false); setError(null); setStep("email");
  }

  useEffect(() => {
    mounted.current = true;
    const onPop = () => resetPasswordStep();
    window.addEventListener("popstate", onPop);
    return () => { mounted.current = false; window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => {
    if (busy || nativePath) return;
    if (step === "password") passwordInput.current?.focus();
    else if (focusEmail.current) { emailInput.current?.focus(); focusEmail.current = false; }
  }, [step, busy, nativePath]);
  useEffect(() => {
    if (authLoaded && isSignedIn && !nativePath && !busy) goHome();
  }, [authLoaded, isSignedIn, nativePath, busy, goHome]);

  function back() {
    if (inFlight.current) return;
    resetPasswordStep();
    if (typeof window !== "undefined" && window.history.state?.diwoLoginStep === "password") window.history.back();
  }

  async function run(operation: (isCurrent: () => boolean) => Promise<void>) {
    if (!ready || isSignedIn || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const currentGeneration = generation.current;
    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    try { await operation(isCurrent); }
    catch (failure) { if (isCurrent()) setError(loginError(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function continueEmail(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !ready || isSignedIn) return;
    const normalized = loginEmail(email);
    if (!normalized) { setError("Introduce un correo electrónico válido."); emailInput.current?.focus(); return; }
    setEmail(normalized); setError(null); setVisible(false); setStep("password");
    if (typeof window !== "undefined") window.history.pushState({ ...window.history.state, diwoLoginStep: "password" }, "", window.location.href);
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    // Read only the native field at explicit submit; never prepopulate a password.
    const submittedPassword = passwordInput.current?.value ?? "";
    if (!submittedPassword) { setError("Introduce tu contraseña."); passwordInput.current?.focus(); return; }
    void run(async isCurrent => {
      if (!signIn || !setActive) return;
      const outcome = await passwordSignIn(signIn, setActive, email, submittedPassword, isCurrent);
      if (isCurrent() && passwordInput.current) passwordInput.current.value = "";
      if (outcome === "complete") goHome();
      else if (typeof outcome === "object" && isCurrent()) router.push(outcome.continueAt);
    });
  }

  function togglePasswordVisibility() {
    // Change presentation only. Never copy an empty/stale React value over autofill.
    setVisible(value => !value);
  }

  function google() {
    void run(async () => { await signIn?.authenticateWithRedirect({ strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/" }); });
  }

  if (nativePath) return <section className="diwo-native-auth" aria-label="Acceso seguro">
    <Link href="/sign-in" className="diwo-auth-link diwo-native-back"><ArrowLeft aria-hidden="true" size={18} /> Volver al acceso</Link>
    <SignIn path={nativePath} routing="path" signUpUrl="/sign-up" forceRedirectUrl="/"
      initialValues={{ emailAddress: signIn?.identifier ?? "" }}
      appearance={{ variables: { colorPrimary: "#FCE921", colorTextOnPrimaryBackground: "#000000", fontFamily: "Satoshi, Arial, sans-serif" } }} />
  </section>;

  if (authLoaded && isSignedIn) return <section className="diwo-native-auth">
    <p role="status">Abriendo Inicio…</p>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Intentional document link: recovery from a stuck client router. */}
    <a href="/" className="diwo-auth-link diwo-native-back">Ir a Inicio</a>
  </section>;

  const disabled = busy || !ready;
  return <section className={`diwo-login ${step === "password" ? "diwo-login-password" : ""}`} aria-label="Iniciar sesión">
    {step === "password" && <button type="button" aria-label="Volver" className="diwo-login-back" disabled={busy} onClick={back}><ArrowLeft aria-hidden="true" size={22} /></button>}
    <Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={454} height={236} priority className="diwo-login-logo" />
    {step === "email" ? <>
      <p className="diwo-login-welcome">BIENVENID@ A<br />DIWO CLUB</p>
      <header className="diwo-login-intro"><h1>Inicia sesión</h1><p>Accede a tus entradas y prepárate para la fiesta</p></header>
      <button type="button" aria-label="Continuar con Google" className="diwo-google-button" disabled={disabled} onClick={google}>
        <svg aria-hidden="true" viewBox="0 0 48 48" className="diwo-google-icon"><path fill="#4285F4" d="M43.6 20.5H24v7.9h11.3c-.5 2.6-2 4.8-4.2 6.3l6.8 5.3c4-3.7 6.3-9.1 6.3-15.5 0-1.4-.2-2.7-.6-4Z" /><path fill="#34A853" d="M24 44c5.7 0 10.5-1.9 14-5.1l-6.8-5.3c-1.9 1.3-4.3 2-7.2 2-5.5 0-10.2-3.7-11.9-8.7l-7 5.4A21 21 0 0 0 24 44Z" /><path fill="#FBBC05" d="M12.1 26.9a12.6 12.6 0 0 1 0-7.8l-7-5.4a21 21 0 0 0 0 18.6l7-5.4Z" /><path fill="#EA4335" d="M24 10.4c3.1 0 5.9 1.1 8.1 3.2l6.1-6.1A20.5 20.5 0 0 0 24 2 21 21 0 0 0 5.1 13.7l7 5.4c1.7-5 6.4-8.7 11.9-8.7Z" /></svg>
        <span>{busy ? "Conectando…" : "Continuar con Google"}</span>
      </button>
      <div className="diwo-login-divider" aria-hidden="true"><span />o<span /></div>
      <form key="email-step" onSubmit={continueEmail} noValidate>
        <div className="diwo-login-field"><label htmlFor="diwo-email" className="sr-only">Correo electrónico</label><input ref={emailInput} id="diwo-email" aria-label="Correo electrónico" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="Correo electrónico" value={email} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? "diwo-login-error" : undefined} onChange={event => { setEmail(event.target.value); setError(null); }} /><Mail aria-hidden="true" size={22} /></div>
        <button type="submit" className="diwo-login-primary" disabled={disabled}>CONTINUAR</button>
      </form>
    </> : <>
      <header className="diwo-login-intro"><h1>Introduce tu contraseña</h1><div className="diwo-login-identifier"><p>{email}</p><button type="button" aria-label="Cambiar correo" className="diwo-auth-link" disabled={busy} onClick={back}>Cambiar correo</button></div></header>
      <form key={`password-step:${email}`} onSubmit={submitPassword} autoComplete="off" noValidate>
        <div className="diwo-login-field">
          <label htmlFor="diwo-password" className="sr-only">Contraseña</label>
          {/* Manual entry by design. No readonly/focus unlock or visibility-dependent value. */}
          <input ref={passwordInput} id="diwo-password" aria-label="Contraseña" name="password" type={visible ? "text" : "password"} autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore="true" placeholder="Contraseña" defaultValue="" aria-invalid={!!error} aria-describedby={error ? "diwo-login-error" : undefined} onChange={() => setError(null)} />
          <button type="button" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible} aria-controls="diwo-password" onPointerDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={togglePasswordVisibility}>
            {visible ? <EyeOff aria-hidden="true" size={22} /> : <Eye aria-hidden="true" size={22} />}
          </button>
        </div>
        <Link href="/sign-in/recover" aria-label="Recuperar contraseña" className="diwo-login-recovery diwo-auth-link">¿Has olvidado tu contraseña?</Link>
        <button type="submit" aria-label="Iniciar sesión" className="diwo-login-primary" disabled={disabled}>{busy ? <><LoaderCircle aria-hidden="true" className="diwo-login-spinner" size={20} /> Accediendo…</> : "INICIAR SESIÓN"}</button>
      </form>
    </>}
    {!ready && <p role="status" className="diwo-login-status">Cargando acceso seguro…</p>}
    {error && <p role="alert" id="diwo-login-error" className="diwo-login-error">{error}</p>}
    <footer className="diwo-login-footer">¿No tienes cuenta? <Link href="/sign-up" className="diwo-auth-link">Regístrate</Link></footer>
  </section>;
}
