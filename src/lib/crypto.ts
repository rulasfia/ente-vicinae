import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** Encrypts text with a base64 AES-256 key into `v1.iv.tag.ciphertext` (parts base64). */
export const seal = (plaintext: string, key: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, ...[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64"))].join(
    ".",
  );
};

/** Inverse of `seal`; throws if the format, key or authentication tag is wrong. */
export const unseal = (sealed: string, key: string) => {
  const [version, ...parts] = sealed.trim().split(".");
  if (version !== VERSION || parts.length !== 3)
    throw new Error("Unrecognized secrets file format");
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};
