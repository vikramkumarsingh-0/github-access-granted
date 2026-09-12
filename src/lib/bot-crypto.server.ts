import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** 32-byte key derived from the generated BOT_CREDENTIAL_KEY secret. */
function key(): Buffer {
  const raw = process.env["BOT_CREDENTIAL_KEY"];
  if (!raw) throw new Error("BOT_CREDENTIAL_KEY is not set");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
