/** Exact allowlist: never full-prefetch QR, admin, previews or payment instructions. */
export function isBuyerCachedPage(path: string): boolean {
  return ["/", "/ticket", "/account", "/request"].includes(path);
}

export function isBuyerPaymentPage(path: string): boolean {
  return /^\/ticket\/payment\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
}

export function isBuyerFlowPage(path: string): boolean {
  return isBuyerCachedPage(path) || isBuyerPaymentPage(path);
}
