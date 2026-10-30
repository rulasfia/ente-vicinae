import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { env, keychain, otpUri, prefs, setupFakeEnte } from "./helpers/fakes";
import { importSecrets } from "../src/lib/import";
import { loadSecrets } from "../src/lib/keyring";

vi.mock("@vicinae/api", async () => {
  const fakes = await import("./helpers/fakes");
  return { environment: fakes.env, getPreferenceValues: () => fakes.prefs };
});
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (await import("./helpers/fakes")).fakeSpawn,
}));

const GITHUB = otpUri("GitHub", "me", "JBSWY3DPEHPK3PXP");
const PROTON = otpUri("Proton", "me", "KRSXG5CTMVRXEZLU");
const GITHUB_RENAMED = otpUri("GitHub", "work", "JBSWY3DPEHPK3PXP");
const AWS = otpUri("AWS", "root", "GEZDGNBVGY3TQOJQ");

let root: string;
let exportDir: string;
let ente: ReturnType<typeof setupFakeEnte>;

const issuers = async () => (await loadSecrets()).map((s) => `${s.issuer}:${s.username}`).sort();

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ente-import-"));
  exportDir = path.join(root, "export");
  mkdirSync(exportDir);
  env.supportPath = path.join(root, "support");
  keychain.reset();
  ente = setupFakeEnte({
    email: "me@example.com",
    exportDir,
    mode: "ok",
    lines: [GITHUB, PROTON],
    backupStamp: "2026-10-30_12-00-01",
  });
  for (const key of Object.keys(prefs)) delete prefs[key];
  prefs.cliPath = ente.bin;
  return () => rmSync(root, { recursive: true, force: true });
});

describe("importSecrets", () => {
  it("stores secrets and leaves no plaintext export behind", async () => {
    expect(await importSecrets(true)).toEqual({ count: 2, skipped: 0, stale: undefined });
    expect(await issuers()).toEqual(["GitHub:me", "Proton:me"]);
    expect(readdirSync(exportDir)).toEqual([]);
  });

  it("re-import mirrors edits, deletions and additions made on another device", async () => {
    await importSecrets(false);
    // A backup the user made themselves, which must survive the cleanup.
    writeFileSync(path.join(exportDir, "ente_auth_2020-01-01_00-00-00.txt"), GITHUB);

    // On the phone: GitHub username edited, Proton deleted, AWS added.
    ente.set({ lines: [GITHUB_RENAMED, AWS] });
    expect((await importSecrets(true)).count).toBe(2);

    expect(await issuers()).toEqual(["AWS:root", "GitHub:work"]);
    // The CLI renamed the previous export to a backup during this run; only that one is removed.
    expect(readdirSync(exportDir)).toEqual(["ente_auth_2020-01-01_00-00-00.txt"]);
  });

  it("keeps stored secrets when the CLI silently fails (exit 0, no file)", async () => {
    await importSecrets(true);
    ente.set({ mode: "fail" });

    await expect(importSecrets(true)).rejects.toThrow(
      /wrote no export \(failed to get entities.*network is unreachable\).*left unchanged/,
    );
    expect(await issuers()).toEqual(["GitHub:me", "Proton:me"]);
  });

  it("falls back to an older export file but reports it as stale", async () => {
    await importSecrets(false);
    ente.set({ mode: "fail", lines: [AWS] });

    const result = await importSecrets(false);
    expect(result.count).toBe(2);
    expect(result.stale?.reason).toMatch(/wrote no export/);
    expect(result.stale?.exportedAt).toBeInstanceOf(Date);
  });

  it("never wipes stored secrets on an empty or unusable export", async () => {
    await importSecrets(true);

    ente.set({ mode: "empty" });
    await expect(importSecrets(true)).rejects.toThrow(/No data to export/);

    ente.set({ mode: "ok", lines: ["otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1"] });
    await expect(importSecrets(true)).rejects.toThrow(/no TOTP accounts/);

    expect(await issuers()).toEqual(["GitHub:me", "Proton:me"]);
    expect(existsSync(path.join(exportDir, "ente_auth.txt"))).toBe(false);
  });

  it("uses the CLI's export dir unless a preference overrides it", async () => {
    await importSecrets(true);
    expect(ente.get().calls.some((args) => args[1] === "update")).toBe(false);

    const custom = path.join(root, "custom dir");
    prefs.exportPath = custom;
    await importSecrets(false);
    expect(ente.get().exportDir).toBe(custom);
    expect(readFileSync(path.join(custom, "ente_auth.txt"), "utf8")).toContain("Proton");
  });
});
