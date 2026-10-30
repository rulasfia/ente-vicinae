import { describe, expect, it } from "vite-plus/test";
import { codesFor, parseSecrets } from "../src/lib/secrets";

const base = "otpauth://totp/user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
const display = (value: object) => `&codeDisplay=${encodeURIComponent(JSON.stringify(value))}`;

describe("parseSecrets", () => {
  it("parses tags and notes, ignores blanks and trashed entries, counts unsupported lines", () => {
    const text = [
      "",
      "not-a-url",
      "otpauth://hotp/u?secret=JBSWY3DPEHPK3PXP&issuer=H&counter=1",
      "otpauth://steam/u?secret=JBSWY3DPEHPK3PXP&issuer=Steam",
      `${base}${display({ tags: [" work "], note: "hi" })}`,
      `${base}${display({ trashed: true })}`,
    ].join("\n");

    const { secrets, skipped } = parseSecrets(text);
    expect(skipped).toBe(3);
    expect(secrets).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        username: "user@example.com",
        issuer: "GitHub",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        tags: ["work"],
        notes: "hi",
        secret: "JBSWY3DPEHPK3PXP",
      },
    ]);
  });

  it("gives stable, distinct ids and merges exact duplicates", () => {
    const other = base.replace("user@", "other@");
    const first = parseSecrets([base, base, other].join("\n")).secrets;
    const again = parseSecrets([other, base].join("\n")).secrets;

    expect(first).toHaveLength(2);
    expect(new Set(first.map((s) => s.id)).size).toBe(2);
    expect(again.map((s) => s.id).sort()).toEqual(first.map((s) => s.id).sort());
    // ids must not leak the account name or secret
    expect(first[0].id).not.toMatch(/github|user|JBSW/i);
  });

  it("repairs malformed Ente export URLs", () => {
    const url =
      "otpauth://totp/u?secret=JBSW-Y3D PEHPK3PXP&amp%3Bissuer=Git+Hub&algorithm=null&digits=null&period=null";
    expect(parseSecrets(url).secrets[0]).toMatchObject({
      issuer: "Git Hub",
      secret: "JBSWY3DPEHPK3PXP",
      period: 30,
      digits: 6,
    });
  });
});

describe("codesFor", () => {
  // RFC 6238 test vectors at T=59s.
  it("honors algorithm, digits and period", () => {
    const [sha1] = parseSecrets(
      "otpauth://totp/a?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=A&algorithm=SHA1&digits=8&period=30",
    ).secrets;
    expect(codesFor(sha1, 59_000)).toMatchObject({ current: "94287082", remaining: 1 });

    const [sha256] = parseSecrets(
      "otpauth://totp/a?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&issuer=A&algorithm=SHA256&digits=8&period=30",
    ).secrets;
    expect(codesFor(sha256, 59_000).current).toBe("46119246");

    const [sixty] = parseSecrets(`${base}&period=60`).secrets;
    expect(codesFor(sixty, 59_000).remaining).toBe(1);
  });
});
