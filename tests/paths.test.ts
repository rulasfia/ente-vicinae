import { describe, expect, it } from "vite-plus/test";
import {
  findExecutable,
  isCliBackup,
  normalizePath,
  parseAccounts,
  samePath,
} from "../src/lib/paths";

describe("findExecutable", () => {
  const onDisk = (files: string[]) => (file: string) => files.includes(file);

  it("ignores relative PATH entries so a planted binary in the cwd is never used", () => {
    const exists = onDisk(["ente", "bin/ente", "/opt/homebrew/bin/ente"]);
    expect(findExecutable("ente", ["", ".", "bin", "/opt/homebrew/bin"], "darwin", exists)).toBe(
      "/opt/homebrew/bin/ente",
    );
    expect(findExecutable("ente", [".", "bin"], "linux", exists)).toBeUndefined();
  });

  it("looks for ente.exe on Windows", () => {
    const exists = onDisk(["C:\\Tools\\ente.exe"]);
    expect(findExecutable("ente", ["C:\\Tools"], "win32", exists)).toBe("C:\\Tools\\ente.exe");
  });
});

describe("path helpers", () => {
  it("expands ~ and compares Windows paths case-insensitively", () => {
    expect(normalizePath(' "~/ente" ', "linux", "/home/me")).toBe("/home/me/ente");
    expect(normalizePath("~\\ente", "win32", "C:\\Users\\me")).toBe("C:\\Users\\me\\ente");
    expect(samePath("C:\\Users\\Me\\Ente", "c:\\users\\me\\ente\\", "win32")).toBe(true);
    expect(samePath("/home/Me", "/home/me", "linux")).toBe(false);
  });

  it("matches only CLI-generated backup names", () => {
    expect(isCliBackup("ente_auth_2026-10-30_12-00-01.txt")).toBe(true);
    expect(isCliBackup("ente_auth.txt")).toBe(false);
    expect(isCliBackup("ente_auth_notes.txt")).toBe(false);
    expect(isCliBackup("../ente_auth_2026-10-30_12-00-01.txt")).toBe(false);
  });
});

describe("parseAccounts", () => {
  it("parses multiple account blocks", () => {
    const output = [
      "Configured accounts: 2",
      "====================================",
      "Email:     photos@example.com",
      "App:       photos",
      "ExportDir: /p",
      "====================================",
      "Email:     me@example.com",
      "App:       auth",
      "ExportDir: C:\\Users\\me\\ente",
      "====================================",
    ].join("\r\n");
    expect(parseAccounts(output)).toEqual([
      { email: "photos@example.com", app: "photos", exportDir: "/p" },
      { email: "me@example.com", app: "auth", exportDir: "C:\\Users\\me\\ente" },
    ]);
  });
});
