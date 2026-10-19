type SignInResult = { status: string | null; createdSessionId?: string | null };
type SignInClient = {
  create(params: { strategy: "password"; identifier: string; password: string }): Promise<SignInResult>;
};

export function loginEmail(value: string): string | null {
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isAuthScreen(path: string): boolean {
  return path === "/sso-callback" || ["/sign-in", "/sign-up"].some(root => path === root || path.startsWith(`${root}/`));
}

export function loginError(error: unknown): string {
  let code: unknown;
  if (error && typeof error === "object") {
    if ("code" in error) code = error.code;
    if ("errors" in error && Array.isArray(error.errors)) {
      const first: unknown = error.errors[0];
      if (first && typeof first === "object" && "code" in first) code = first.code;
    }
  }
  if (code === "form_identifier_not_found" || code === "form_password_incorrect" || code === "form_password_or_identifier_incorrect") {
    return "El correo electrónico o la contraseña no son correctos. Revisa los datos e inténtalo de nuevo.";
  }
  if (code === "strategy_for_user_invalid") {
    return "No se puede acceder con contraseña. Vuelve para entrar con Google o usa «¿Has olvidado tu contraseña?».";
  }
  if (code === "too_many_requests") return "Espera un momento antes de volver a intentarlo.";
  if (code === "network_error") return "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.";
  return "No hemos podido iniciar sesión en este momento. Inténtalo de nuevo más tarde.";
}

export async function passwordSignIn(
  client: SignInClient, setActive: (params: { session: string }) => Promise<unknown>,
  email: string, password: string, isCurrent: () => boolean = () => true,
): Promise<"complete" | "continue" | "cancelled"> {
  const result = await client.create({ strategy: "password", identifier: email, password });
  if (!isCurrent()) return "cancelled";
  if (result.status === "complete") {
    if (typeof result.createdSessionId !== "string" || !result.createdSessionId) throw new Error("missing_completed_session");
    await setActive({ session: result.createdSessionId });
    return isCurrent() ? "complete" : "cancelled";
  }
  // Device verification is still an incomplete sign-in, never a valid session.
  if (["needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password", "needs_client_trust"].includes(result.status ?? "")) return "continue";
  throw new Error("unexpected_sign_in_status");
}
