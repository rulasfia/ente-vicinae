import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { seal, unseal } from "../src/lib/crypto";

describe("seal", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips and rejects a wrong key or tampered data", () => {
    const sealed = seal('[{"issuer":"GitHub"}]', key);
    expect(unseal(sealed, key)).toBe('[{"issuer":"GitHub"}]');
    expect(() => unseal(sealed, randomBytes(32).toString("base64"))).toThrow();

    const [iv, tag, data] = sealed.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => unseal([iv, tag, flipped.toString("base64")].join("."), key)).toThrow();
  });
});
