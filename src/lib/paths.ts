import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";

// Pure helpers (no @vicinae/api) so they can be unit tested; `platform` is injectable for the same reason.

export const EXPORT_FILE = "ente_auth.txt";

// `ente export` renames an existing ente_auth.txt to this pattern before writing a new one.
const CLI_BACKUP = /^ente_auth_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/;
export const isCliBackup = (name: string) => CLI_BACKUP.test(name);

const pathFor = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);

/** Strips wrapping quotes and expands a leading "~/" (or "~\" on Windows). */
export const normalizePath = (value: string, platform = process.platform, home = os.homedir()) => {
  const trimmed = value.trim().replace(/^(['"])(.*)\1$/, "$2");
  return /^~[\\/]/.test(trimmed) ? pathFor(platform).join(home, trimmed.slice(2)) : trimmed;
};

export const samePath = (a: string, b: string, platform = process.platform) => {
  const p = pathFor(platform);
  return platform === "win32"
    ? p.resolve(a).toLowerCase() === p.resolve(b).toLowerCase()
    : p.resolve(a) === p.resolve(b);
};

const isFile = (file: string) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolves a bare executable name against absolute PATH entries plus `extraDirs`. Relative entries
 * (".", "") are skipped so a binary planted in the working directory can't be picked up.
 */
export const findExecutable = (
  name: string,
  dirs: string[],
  platform = process.platform,
  exists = isFile,
) => {
  const p = pathFor(platform);
  const file = platform === "win32" && !/\.exe$/i.test(name) ? `${name}.exe` : name;
  return dirs
    .filter((dir) => p.isAbsolute(dir))
    .map((dir) => p.join(dir, file))
    .find(exists);
};

export type EnteAccount = { email?: string; app?: string; exportDir?: string };

/** Parses `ente account list` output into account blocks separated by "====" lines. */
export const parseAccounts = (output: string) => {
  const accounts: EnteAccount[] = [];
  let current: EnteAccount = {};
  const flush = () => {
    if (current.app || current.exportDir) accounts.push(current);
    current = {};
  };

  for (const line of output.split(/\r?\n/).map((l) => l.trim())) {
    if (/^=+$/.test(line)) {
      flush();
      continue;
    }
    const [, key, value = ""] = line.match(/^([A-Za-z]+):\s*(.*)$/) ?? [];
    if (key === "Email") current.email = value.trim();
    if (key === "App") current.app = value.trim().toLowerCase();
    if (key === "ExportDir") current.exportDir = value.trim();
  }
  flush();
  return accounts;
};
