import { environment } from "@vicinae/api";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { seal, unseal } from "./crypto";
import type { Secret } from "./secrets";

// Vicinae's LocalStorage is a plaintext SQLite table (unlike Raycast's encrypted store), so secrets
// are AES-256-GCM encrypted into the support dir and only the 32-byte key goes to the OS secret
// store (some, like Windows Credential Manager, cap entries far below a full export).
// Threat model: protects data at rest (backups, disk access, other users), not same-user malware.
const SERVICE = "vicinae-ente-auth";
const ACCOUNT = "encryption-key";

const dataFile = () => path.join(environment.supportPath, "secrets.enc");
const dpapiKeyFile = () => path.join(environment.supportPath, "key.dpapi");

type Result = { code: number | null; stdout: string; stderr: string };

// Runs a command, feeding `input` over stdin so secrets never appear in argv.
const run = (cmd: string, args: string[], input = "") =>
  new Promise<Result>((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(new Error(`Could not run ${cmd}: ${error.message}`)));
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });

const expectOk = (result: Result, what: string) => {
  if (result.code !== 0)
    throw new Error(result.stderr || `${what} failed with exit code ${result.code}`);
  return result.stdout;
};

// Writes via a temp file + rename so a crash never leaves a truncated file, and forces 0600 even
// when the file already existed with looser permissions (mode is ignored on Windows).
const writeAtomic = async (file: string, content: string) => {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
};

// Absolute path: a bare name would be searched in the working directory first on Windows.
const powershellPath = () =>
  path.win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

// Base64 in, base64 out; DPAPI scoped to the current Windows user.
const dpapi = async (method: "Protect" | "Unprotect", input: string) => {
  const script =
    "Add-Type -AssemblyName System.Security; " +
    "$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
    `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${method}($b, $null, 'CurrentUser'))`;
  const args = ["-NoProfile", "-NonInteractive", "-Command", script];
  return expectOk(await run(powershellPath(), args, input), `DPAPI ${method}`);
};

type KeyStore = { get: () => Promise<string | undefined>; set: (key: string) => Promise<void> };

const linuxAttrs = ["service", SERVICE, "key", ACCOUNT];

const keyStores: Partial<Record<NodeJS.Platform, KeyStore>> = {
  // Secret Service (gnome-keyring, KWallet, KeePassXC). `lookup` exits 1 when nothing is stored.
  linux: {
    get: async () => {
      const result = await run("secret-tool", ["lookup", ...linuxAttrs]);
      return result.code === 1 ? undefined : expectOk(result, "secret-tool lookup") || undefined;
    },
    set: async (key) => {
      const args = ["store", "--label=Ente Auth (Vicinae)", ...linuxAttrs];
      expectOk(await run("secret-tool", args, key), "secret-tool store");
    },
  },
  // Login Keychain. Exit 44 means not found; `-i` reads the command from stdin to keep the key off argv.
  darwin: {
    get: async () => {
      const args = ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"];
      const result = await run("/usr/bin/security", args);
      return result.code === 44 ? undefined : expectOk(result, "Keychain lookup") || undefined;
    },
    set: async (key) => {
      const command = `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${key}\n`;
      expectOk(await run("/usr/bin/security", ["-i"], command), "Keychain store");
    },
  },
  // DPAPI-protected key file next to the data; only this Windows user can decrypt it.
  win32: {
    get: async () =>
      existsSync(dpapiKeyFile())
        ? dpapi("Unprotect", await readFile(dpapiKeyFile(), "utf8"))
        : undefined,
    set: async (key) => writeAtomic(dpapiKeyFile(), await dpapi("Protect", key)),
  },
};

const keyStore = () => {
  const store = keyStores[process.platform];
  if (!store) throw new Error(`No secure key storage for platform ${process.platform}`);
  return store;
};

export const loadSecrets = async (): Promise<Secret[]> => {
  if (!existsSync(dataFile())) return [];
  const key = await keyStore().get();
  if (!key) {
    throw new Error("Encryption key missing from the system keychain. Run Import Secrets again.");
  }
  try {
    return JSON.parse(unseal(await readFile(dataFile(), "utf8"), key));
  } catch {
    throw new Error("Stored secrets could not be decrypted. Run Import Secrets again.");
  }
};

/** Replaces the stored secrets. Reuses the existing key, creating one on first import. */
export const saveSecrets = async (secrets: Secret[]) => {
  const store = keyStore();
  await mkdir(environment.supportPath, { recursive: true, mode: 0o700 });

  let key = await store.get();
  if (!key) {
    await store.set(randomBytes(32).toString("base64"));
    // Read back so a silently failed store can't leave data we can never decrypt.
    key = await store.get();
    if (!key) throw new Error("Could not save the encryption key to the system keychain");
  }
  await writeAtomic(dataFile(), seal(JSON.stringify(secrets), key));
};
