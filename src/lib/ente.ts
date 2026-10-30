import { getPreferenceValues } from "@vicinae/api";
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  EXPORT_FILE,
  findExecutable,
  isCliBackup,
  normalizePath,
  parseAccounts,
  samePath,
} from "./paths";

const execFileAsync = promisify(execFile);

// Apps launched from the macOS GUI get a minimal PATH without Homebrew, so also probe common dirs.
const EXTRA_BIN_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin"],
  linux: [path.join(os.homedir(), ".local", "bin"), "/usr/local/bin"],
};

// Accepts a binary path, a directory containing the binary, or a bare name searched on PATH.
const cliPath = () => {
  const configured = normalizePath(getPreferenceValues<Preferences>().cliPath || "ente");
  if (path.basename(configured) !== configured) {
    const isDir = statSync(configured, { throwIfNoEntry: false })?.isDirectory();
    return isDir
      ? path.join(configured, process.platform === "win32" ? "ente.exe" : "ente")
      : configured;
  }
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(EXTRA_BIN_DIRS[process.platform] ?? []),
  ];
  const found = findExecutable(configured, dirs);
  if (!found) throw new Error(`Ente CLI "${configured}" not found on PATH`);
  return found;
};

const runEnte = async (...args: string[]) => {
  const { stdout, stderr } = await execFileAsync(cliPath(), args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return `${stdout}\n${stderr}`.trim();
};

export const hasEnteCli = async () => {
  try {
    await runEnte("version");
    return true;
  } catch {
    return false;
  }
};

const authAccount = async () => {
  const account = parseAccounts(await runEnte("account", "list")).find((a) => a.app === "auth");
  if (!account?.email) {
    throw new Error("No auth account in Ente CLI. Run `ente account add` and choose the auth app.");
  }
  return { ...account, email: account.email };
};

const preferredExportDir = () => {
  const configured = getPreferenceValues<Preferences>().exportPath?.trim();
  return configured ? normalizePath(configured) : undefined;
};

/** The export dir from preferences, else the one configured in the Ente CLI. Never changes CLI config. */
export const resolveExportDir = async () => {
  const dir = preferredExportDir() ?? (await authAccount()).exportDir;
  if (!dir)
    throw new Error(
      "No export directory set. Set one in preferences or with `ente account update`.",
    );
  return normalizePath(dir);
};

/**
 * Like `resolveExportDir`, but when preferences name a different dir, creates it and points the
 * CLI's auth account at it (the CLI has no per-run output flag).
 */
export const prepareExportDir = async () => {
  const account = await authAccount();
  const preferred = preferredExportDir();
  if (!preferred) return resolveExportDir();

  await mkdir(preferred, { recursive: true, mode: 0o700 });
  if (!account.exportDir || !samePath(normalizePath(account.exportDir), preferred)) {
    await runEnte(
      "account",
      "update",
      "--app",
      "auth",
      "--email",
      account.email,
      "--dir",
      preferred,
    );
  }
  return preferred;
};

const fileSignature = (file: string) => {
  const info = statSync(file, { throwIfNoEntry: false });
  return info && `${info.ino}:${info.mtimeMs}:${info.size}`;
};

/** Names of CLI-made export backups in `dir`. */
export const listBackups = (dir: string) => {
  try {
    return readdirSync(dir).filter(isCliBackup);
  } catch {
    return [];
  }
};

/**
 * Runs `ente export` into `dir`. The CLI exits 0 even when the export fails (network, expired
 * session, empty vault), so success is judged by whether ente_auth.txt was rewritten.
 * `createdBackups` lists the plaintext backups this run made by renaming a previous export.
 */
export const runExport = async (dir: string) => {
  const file = path.join(dir, EXPORT_FILE);
  const before = fileSignature(file);
  const backupsBefore = new Set(listBackups(dir));

  const log = await runEnte("export");

  const after = fileSignature(file);
  return {
    file,
    written: after !== undefined && after !== before,
    createdBackups: listBackups(dir).filter((name) => !backupsBefore.has(name)),
    log,
  };
};

/** Last meaningful CLI log line, for error messages. */
export const lastLogLine = (log: string) =>
  log
    .split(/\r?\n/)
    // Go's log output: optional "[app-email] " prefix, then "2006/01/02 15:04:05 ".
    .map((line) =>
      line.replace(/^(\[[^\]]*\]\s*)?(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\s*)?/, "").trim(),
    )
    .filter(Boolean)
    .at(-1) ?? "";

/**
 * Permanently deletes ente_auth.txt plus the given backup names in `dir` (not trashed, so no copy
 * lingers). Names not matching the CLI backup pattern are ignored. Returns how many were removed.
 */
export const removeExportFiles = async (dir: string, backups: string[] = []) => {
  const files = [EXPORT_FILE, ...backups.filter(isCliBackup)].map((name) => path.join(dir, name));
  const existing = files.filter((file) => statSync(file, { throwIfNoEntry: false }));
  await Promise.all(existing.map((file) => rm(file, { force: true })));
  return existing.length;
};
