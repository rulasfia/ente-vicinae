import { createHash } from "node:crypto";
import * as OTPAuth from "otpauth";

export type Secret = {
  /** Stable across re-imports; a hash, so it can key plaintext stores without naming the account. */
  id: string;
  username: string;
  issuer: string;
  algorithm: string;
  digits: number;
  period: number;
  tags: string[];
  notes: string;
  secret: string;
};

// Repairs malformed otpauth URLs seen in Ente exports.
const sanitizeURL = (url: string) =>
  url
    // HTML entity + URL encoding corruption (&amp%3B -> &)
    .replace(/&amp%3B/g, "&")
    // Double URL encoding (%25XX -> %XX)
    .replace(/%25([0-9A-Fa-f]{2})/g, "%$1")
    // Bare `&issuer&`
    .replace(/([?&]issuer)(?=&|$)/g, "$1=")
    // Null OTP params: default period, drop algorithm/digits so otpauth uses its defaults
    .replace(/([?&])period=null(?=&|$)/g, "$1period=30")
    .replace(/([?&])(algorithm|digits)=null(?=&|$)/g, "$1")
    .replace(/\?&/g, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "")
    // Whitespace, dashes and plus signs inside the secret
    .replace(
      /([?&]secret=)([^&]+)/g,
      (_, prefix: string, secret: string) => prefix + secret.replace(/[\s\-+]/g, ""),
    );

const parseSecretURL = (raw: string): Secret | null => {
  const url = sanitizeURL(raw);
  const otp = OTPAuth.URI.parse(url);
  if (!(otp instanceof OTPAuth.TOTP)) throw new Error("Unsupported OTP type");

  const codeDisplay = new URL(url).searchParams.get("codeDisplay");
  const display: { trashed?: boolean; tags?: string[]; note?: string } | null = codeDisplay
    ? JSON.parse(codeDisplay)
    : null;
  if (display?.trashed) return null;

  const issuer = otp.issuer.replace(/\+/g, " ");
  const secret = otp.secret.base32;
  return {
    id: createHash("sha256")
      .update(`${issuer}\n${otp.label}\n${secret}`)
      .digest("hex")
      .slice(0, 16),
    username: otp.label,
    issuer,
    algorithm: otp.algorithm,
    digits: otp.digits,
    period: otp.period,
    tags: display?.tags?.map((tag) => tag.trim()) ?? [],
    notes: display?.note ?? "",
    secret,
  };
};

/**
 * Parses an `ente_auth.txt` export. Blank and trashed lines are ignored; exact duplicates are
 * merged; HOTP, Steam and unparsable lines are counted in `skipped`. Never logs line contents.
 */
export const parseSecrets = (text: string) => {
  const byId = new Map<string, Secret>();
  let skipped = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const secret = parseSecretURL(line);
      if (secret) byId.set(secret.id, secret);
    } catch {
      skipped++;
    }
  }
  return { secrets: [...byId.values()], skipped };
};

/** Current and next code for a secret at `now` (ms), honoring its algorithm, digits and period. */
export const codesFor = (secret: Secret, now: number) => {
  const totp = new OTPAuth.TOTP({
    secret: secret.secret,
    algorithm: secret.algorithm,
    digits: secret.digits,
    period: secret.period,
  });
  return {
    current: totp.generate({ timestamp: now }),
    next: totp.generate({ timestamp: now + secret.period * 1000 }),
    remaining: totp.period - (Math.floor(now / 1000) % totp.period),
  };
};
