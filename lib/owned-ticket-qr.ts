import "server-only";
import QRCode from "qrcode";

const token = /^[0-9a-f]{64}$/;

export async function renderOwnedTicketQr(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !token.test(value)) return null;
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "M", type: "image/png", margin: 4, width: 640,
    color: { dark: "#000000FF", light: "#FFFFFFFF" },
  });
}
