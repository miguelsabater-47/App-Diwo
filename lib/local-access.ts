/** Only owned Development keys are accepted in this local-auth block. */
export function hasDevelopmentClerkKeys(
  env: Record<string, string | undefined>,
): boolean {
  const publicKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;
  return Boolean(
    publicKey &&
      secretKey &&
      publicKey === publicKey.trim() &&
      secretKey === secretKey.trim() &&
      /^pk_test_[A-Za-z0-9+/=_-]+$/.test(publicKey) &&
      /^sk_test_[A-Za-z0-9_-]+$/.test(secretKey),
  );
}

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** No authorization is inferred from email or editable Clerk metadata. */
export function isPrivilegedPath(pathname: string): boolean {
  return ["/admin", "/api/admin", "/scan"].some((base) =>
    matchesPath(pathname, base),
  );
}

export function isLegacyRedemptionPath(pathname: string): boolean {
  return matchesPath(pathname, "/api/redeem");
}
