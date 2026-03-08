import { createHmac } from "crypto";

export function generateHmacSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}
