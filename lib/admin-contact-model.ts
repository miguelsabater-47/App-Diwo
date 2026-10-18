const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function primaryVerifiedEmail(user: unknown, expectedId: string): string | null {
  if (!record(user) || user.id !== expectedId || typeof user.primaryEmailAddressId !== "string" || !Array.isArray(user.emailAddresses)) return null;
  const primary = user.emailAddresses.find(item => record(item) && item.id === user.primaryEmailAddressId);
  return record(primary) && record(primary.verification) && primary.verification.status === "verified" &&
    typeof primary.emailAddress === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primary.emailAddress) ? primary.emailAddress : null;
}
