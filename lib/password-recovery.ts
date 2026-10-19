/** Never expose provider messages, account existence or submitted credentials. */
export function recoveryError(error: unknown): string {
  let code: unknown;
  if (error && typeof error === "object") {
    if ("code" in error) code = error.code;
    if ("errors" in error && Array.isArray(error.errors)) {
      const first: unknown = error.errors[0];
      if (first && typeof first === "object" && "code" in first) code = first.code;
    }
  }
  if (code === "form_code_incorrect") return "El código no es correcto. Revísalo e inténtalo de nuevo.";
  if (code === "verification_expired" || code === "verification_failed" || code === "form_code_expired") {
    return "El código ha caducado o ya no es válido. Solicita uno nuevo.";
  }
  if (code === "form_password_pwned") return "Esta contraseña aparece en una filtración. Elige otra que no hayas utilizado antes.";
  if (code === "form_password_length_too_short") return "La contraseña es demasiado corta. Elige una más larga.";
  if (code === "form_password_validation_failed" || code === "form_password_not_strong_enough") {
    return "La contraseña no cumple los requisitos de seguridad. Elige una más segura.";
  }
  if (code === "too_many_requests") return "Espera un momento antes de volver a intentarlo.";
  if (code === "network_error") return "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.";
  return "No hemos podido completar la recuperación. Revisa los datos o vuelve al acceso para entrar con Google.";
}
