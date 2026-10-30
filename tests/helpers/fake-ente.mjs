#!/usr/bin/env node
// Stand-in for the Ente CLI, mirroring the real behavior the extension depends on:
// `export` exits 0 even on failure, and renames a previous ente_auth.txt to a timestamped backup.
// State (account, mode, lines to export, call log) lives in the JSON file at $FAKE_ENTE_STATE.
import fs from "node:fs";
import path from "node:path";

const statePath = process.env.FAKE_ENTE_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);

const log = (message) => console.error(`[auth-${state.email}] 2026/10/30 12:00:00 ${message}`);

if (args[0] === "version") {
  console.log("Version v0.2.3");
} else if (args[0] === "account" && args[1] === "list") {
  console.log(
    [
      "Configured accounts: 1",
      "====================================",
      `Email:     ${state.email}`,
      "ID:        1111",
      "App:       auth",
      `ExportDir: ${state.exportDir}`,
      "====================================",
    ].join("\n"),
  );
} else if (args[0] === "account" && args[1] === "update") {
  state.exportDir = args[args.indexOf("--dir") + 1];
} else if (args[0] === "export") {
  if (state.mode === "fail") {
    log("failed to get entities: Get https://api.ente.io: dial tcp: network is unreachable");
  } else if (state.mode === "empty") {
    log("No data to export");
  } else {
    const out = path.join(state.exportDir, "ente_auth.txt");
    if (fs.existsSync(out)) {
      fs.renameSync(out, path.join(state.exportDir, `ente_auth_${state.backupStamp}.txt`));
    }
    fs.writeFileSync(out, state.lines.map((line) => `${line}\n`).join(""), { mode: 0o600 });
  }
}

fs.writeFileSync(statePath, JSON.stringify(state));
