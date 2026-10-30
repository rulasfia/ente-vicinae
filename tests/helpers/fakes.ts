import { EventEmitter } from "node:events";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

// Shared state for the `@vicinae/api` and `node:child_process` mocks in each test file.
export const env = { supportPath: "" };
export const prefs: Record<string, unknown> = {};

/** Simulated OS secret stores. `failSet` makes stores silently drop (Keychain) or fail (others). */
export const keychain = {
  key: undefined as string | undefined,
  failSet: false,
  calls: [] as { cmd: string; args: string[]; stdin: string }[],
  reset() {
    this.key = undefined;
    this.failSet = false;
    this.calls = [];
  },
};

const respond = (cmd: string, args: string[], stdin: string): [number, string, string] => {
  const name = path.basename(cmd.replaceAll("\\", "/"));
  if (name === "secret-tool" && args[0] === "lookup")
    return keychain.key ? [0, keychain.key, ""] : [1, "", ""];
  if (name === "secret-tool" && args[0] === "store") {
    if (keychain.failSet) return [1, "", "Cannot create an item in a locked collection"];
    keychain.key = stdin;
    return [0, "", ""];
  }
  if (name === "security" && args[0] === "find-generic-password") {
    return keychain.key
      ? [0, `${keychain.key}\n`, ""]
      : [44, "", "The specified item could not be found"];
  }
  // `security -i` reports success even when the inner command fails.
  if (name === "security" && args[0] === "-i") {
    if (!keychain.failSet) keychain.key = stdin.match(/-w (\S+)/)?.[1];
    return [0, "", ""];
  }
  if (name === "powershell.exe") {
    if (keychain.failSet) return [1, "", "boom"];
    const input = stdin.trim();
    return args.at(-1)!.includes("::Protect(")
      ? [0, Buffer.from(`dpapi:${input}`).toString("base64"), ""]
      : [
          0,
          Buffer.from(input, "base64")
            .toString()
            .replace(/^dpapi:/, ""),
          "",
        ];
  }
  return [127, "", `unexpected command ${cmd}`];
};

/** Minimal `spawn` replacement routing keychain commands to `keychain`. */
export const fakeSpawn = (cmd: string, args: string[]) => {
  const child = new EventEmitter() as EventEmitter &
    Record<"stdin" | "stdout" | "stderr", PassThrough>;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const chunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stdin.on("finish", () => {
    const stdin = Buffer.concat(chunks).toString();
    keychain.calls.push({ cmd, args, stdin });
    const [code, out, err] = respond(cmd, args, stdin);
    child.stdout.once("end", () => setImmediate(() => child.emit("close", code)));
    child.stderr.end(err);
    child.stdout.end(out);
  });
  return child;
};

export type FakeEnteState = {
  email: string;
  exportDir: string;
  mode: "ok" | "fail" | "empty";
  lines: string[];
  backupStamp: string;
  calls: string[][];
};

/** Installs the fake Ente CLI into a temp dir and returns accessors for its state. */
export const setupFakeEnte = (initial: Omit<FakeEnteState, "calls">) => {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-ente-"));
  const bin = path.join(dir, "ente");
  copyFileSync(path.join(import.meta.dirname, "fake-ente.mjs"), bin);
  chmodSync(bin, 0o755);
  const statePath = path.join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ ...initial, calls: [] }));
  process.env.FAKE_ENTE_STATE = statePath;

  return {
    bin,
    get: (): FakeEnteState => JSON.parse(readFileSync(statePath, "utf8")),
    set: (patch: Partial<FakeEnteState>) =>
      writeFileSync(
        statePath,
        JSON.stringify({ ...JSON.parse(readFileSync(statePath, "utf8")), ...patch }),
      ),
  };
};

export const otpUri = (issuer: string, user: string, secret: string, extra = "") =>
  `otpauth://totp/${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}${extra}`;
