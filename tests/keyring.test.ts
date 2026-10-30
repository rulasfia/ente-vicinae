import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { env, keychain } from "./helpers/fakes";
import { loadSecrets, saveSecrets } from "../src/lib/keyring";
import type { Secret } from "../src/lib/secrets";

vi.mock("@vicinae/api", async () => ({ environment: (await import("./helpers/fakes")).env }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (await import("./helpers/fakes")).fakeSpawn,
}));

const secret = (issuer: string, raw: string): Secret => ({
  id: issuer,
  issuer,
  username: "me@example.com",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  tags: [],
  notes: "",
  secret: raw,
});

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform });

describe.each(["linux", "darwin", "win32"] as const)("keyring on %s", (platform) => {
  beforeEach(() => {
    env.supportPath = mkdtempSync(path.join(tmpdir(), "ente-support-"));
    keychain.reset();
    setPlatform(platform);
  });
  afterEach(() => {
    setPlatform(realPlatform);
    rmSync(env.supportPath, { recursive: true, force: true });
  });

  const dataFile = () => path.join(env.supportPath, "secrets.enc");

  it("round-trips, replaces on re-save, and never exposes plaintext or the key", async () => {
    expect(await loadSecrets()).toEqual([]);

    await saveSecrets([secret("GitHub", "JBSWY3DPEHPK3PXP"), secret("Proton", "KRSXG5CTMVRXEZLU")]);
    await saveSecrets([secret("GitHub", "JBSWY3DPEHPK3PXP")]);
    expect(await loadSecrets()).toEqual([secret("GitHub", "JBSWY3DPEHPK3PXP")]);

    const stored = readFileSync(dataFile(), "utf8");
    expect(stored).not.toMatch(/JBSWY3DPEHPK3PXP|GitHub/);
    expect(statSync(dataFile()).mode & 0o777).toBe(0o600);

    // The base64 key only travels over stdin, and the second save reuses it.
    for (const call of keychain.calls)
      expect(call.args.join(" ")).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    const stores = keychain.calls.filter(
      (c) => c.args[0] === "store" || c.args[0] === "-i" || c.args.at(-1)!.includes("::Protect("),
    );
    expect(stores).toHaveLength(1);
  });

  it("writes nothing when the key can't be stored", async () => {
    keychain.failSet = true;
    await expect(saveSecrets([secret("GitHub", "JBSWY3DPEHPK3PXP")])).rejects.toThrow();
    expect(existsSync(dataFile())).toBe(false);
  });

  it("asks for a re-import when the key is gone or the data was tampered with", async () => {
    await saveSecrets([secret("GitHub", "JBSWY3DPEHPK3PXP")]);

    const sealed = readFileSync(dataFile(), "utf8");
    writeFileSync(dataFile(), `${sealed.slice(0, -4)}AAA=`);
    await expect(loadSecrets()).rejects.toThrow(/Run Import Secrets again/);

    keychain.key = undefined;
    rmSync(path.join(env.supportPath, "key.dpapi"), { force: true });
    await expect(loadSecrets()).rejects.toThrow(/Run Import Secrets again/);
  });
});
