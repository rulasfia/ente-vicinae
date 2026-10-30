# Ente Auth for Vicinae

Search your [Ente Auth](https://ente.io/auth) accounts from [Vicinae](https://vicinae.com) and paste or copy TOTP codes. Works on Linux, macOS and Windows.

Port of the [Raycast Ente Auth extension](https://github.com/raycast/extensions/tree/main/extensions/ente-auth). Not affiliated with Ente.

## Requirements

- [Vicinae](https://vicinae.com)
- [Node.js](https://nodejs.org) 20 or newer, and [pnpm](https://pnpm.io) (npm also works)
- The [Ente CLI](https://github.com/ente-io/ente/tree/main/cli#readme), installed and logged in to an **auth** account. Check it with:

  ```sh
  ente account list   # should show "App: auth" and an "ExportDir"
  ```

- Linux only: `secret-tool` (libsecret) and a running keyring such as GNOME Keyring or KWallet

## Install

```sh
git clone https://github.com/rulasfia/ente-vicinae.git
cd ente-vicinae
pnpm install
pnpm build
```

`pnpm build` installs the extension into Vicinae. Then, in Vicinae:

1. Run **Import Secrets**
2. Run **Get TOTP**

Run **Import Secrets** again whenever you add, edit or remove accounts in Ente.

### Not showing up?

If this is your first locally built extension, restart Vicinae once. It only watches its extensions folder if that folder existed when it started.

If import says the Ente CLI can't be found, set **Ente CLI Path** in the extension preferences. The extension looks on `PATH`, plus `/opt/homebrew/bin` and `/usr/local/bin` on macOS and `~/.local/bin` on Linux.

## Commands

| Command        | What it does                                                                       |
| -------------- | ---------------------------------------------------------------------------------- |
| Get TOTP       | Search accounts, paste or copy the current code, copy the next one                 |
| Import Secrets | Runs `ente export`, stores the result encrypted, deletes the plaintext export      |
| Export Secrets | Runs `ente export` and lists the accounts. Leaves a plaintext file. Off by default |
| Delete Export  | Deletes `ente_auth.txt` and the CLI's `ente_auth_<date>.txt` backups               |

## Preferences

| Preference               | Default   | Notes                                                                  |
| ------------------------ | --------- | ---------------------------------------------------------------------- |
| Ente CLI Path            | `ente`    | Binary path, the folder containing it, or a name found on `PATH`       |
| Ente CLI Export Location | CLI's own | If set, the CLI's auth account is pointed at this folder               |
| Primary Action           | Paste     | What Enter does                                                        |
| Privacy                  | On        | Delete the plaintext export after import                               |
| Service Icons            | On        | Fetch icons from Ente's icon registry and Simple Icons by service name |

## How your secrets are stored

`ente export` writes every secret to a plaintext file. Import reads it, then deletes it along with any backup copy the CLI made during that run.

The secrets are stored AES-256-GCM encrypted in the extension's data folder. The encryption key lives in your OS keychain:

| OS      | Key stored in                                      |
| ------- | -------------------------------------------------- |
| Linux   | Secret Service (via `secret-tool`)                 |
| macOS   | Login Keychain (via `/usr/bin/security`)           |
| Windows | A DPAPI-protected file, readable only by your user |

- The key is passed to these tools over stdin, never as a command-line argument.
- Vicinae's own LocalStorage is not encrypted, so it only holds usage ranking (by opaque hash) and icon lookup misses (by service name).
- Copied codes are hidden from Vicinae's clipboard history. Pasted codes are not; Vicinae's paste API has no option for it.
- Turn off **Service Icons** if you don't want service names sent to GitHub and the Simple Icons CDN.
- This protects your secrets at rest (backups, disk access, other users). It does not protect against malware running as you.

## Re-importing

Import replaces the stored list with the latest export, so changes made on other devices carry over. `ente export` exits successfully even when it fails, so the extension checks that a new export was actually written:

- Network error, expired login or empty vault: nothing is replaced.
- An older export file is still there: it is imported, and the toast says so with the file's date.
- HOTP, Steam and invalid entries are skipped, and the toast shows how many.

## Development

```sh
pnpm dev               # live-reloading session in a running Vicinae
pnpm test              # tests use a fake Ente CLI and simulated keychains
pnpm check             # format and lint
pnpm exec tsc --noEmit
```

## License

MIT. See [LICENSE](LICENSE). Based on the Raycast extension by chkpwd, albarin, wires5210, xmok and jakoss.
