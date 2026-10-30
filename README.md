# Ente Auth for Vicinae

TOTP codes from [Ente Auth](https://ente.io/auth) in Vicinae, on Linux, macOS and Windows. Port of the [Raycast Ente Auth extension](https://github.com/raycast/extensions/tree/main/extensions/ente-auth) by chkpwd, albarin, wires5210, xmok and jakoss (MIT, see `LICENSE`).

## Setup

1. Install the [Ente CLI](https://github.com/ente-io/ente/tree/main/cli#readme). The extension finds `ente` (`ente.exe`) on `PATH`, plus `/opt/homebrew/bin` and `/usr/local/bin` on macOS and `~/.local/bin` on Linux. Otherwise set **Ente CLI Path**.
2. `ente account add`, app `auth`, and pick an export directory.
3. Run **Import Secrets**, then **Get TOTP**. Re-run **Import Secrets** after changing accounts on another device.

## Commands

| Command        | Does                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| Get TOTP       | Search accounts; paste or copy the current code, copy the next one                           |
| Import Secrets | `ente export`, store the result encrypted, delete the plaintext export                       |
| Export Secrets | `ente export` and list accounts; leaves a plaintext file (disabled by default)               |
| Delete Export  | Delete `ente_auth.txt` and the CLI's timestamped `ente_auth_*.txt` backups in the export dir |

## Security

Secrets are AES-256-GCM encrypted into the extension's support dir (`secrets.enc`, mode 0600, written atomically). Vicinae's LocalStorage is plaintext SQLite, so it only holds icon lookup misses (by service name) and usage ranking (by opaque hash). The 32-byte key is kept in:

| OS      | Key store                                                                        |
| ------- | -------------------------------------------------------------------------------- |
| Linux   | Secret Service via `secret-tool` (needs libsecret plus gnome-keyring or KWallet) |
| macOS   | Login Keychain via `/usr/bin/security`                                           |
| Windows | DPAPI-protected `key.dpapi` (current user only), via built-in `powershell.exe`   |

- The key only travels over stdin, never in process arguments.
- This protects data at rest (backups, disk access, other users), not against malware running as you.
- `ente export` writes every secret in plaintext. Import deletes it afterwards (preference, on by default), along with any backup the CLI made during that run. Backups made outside the extension are left alone; **Delete Export** removes them.
- Copied codes are hidden from Vicinae's clipboard history. Pasted codes are not, since Vicinae's paste API has no option for it.
- **Service Icons** looks up service names on GitHub (Ente's icon registry) and the Simple Icons CDN. Turn it off to keep them local.

## Re-import behavior

Import replaces the stored list with the latest export, so edits, deletions and additions made elsewhere carry over. Because `ente export` exits 0 even when it fails, the extension checks that the export file was actually rewritten:

- Network error, expired session or empty vault: import fails and stored secrets stay as they were.
- An older export file is still present: it is imported, and the toast says the export failed and shows that file's date.
- Export with no usable TOTP entries: nothing is replaced.
- HOTP, Steam and invalid entries are skipped and counted.

**Ente CLI Export Location** is optional. When empty, the CLI's configured dir is used and its config is never changed. When set, the CLI's auth account is pointed at it.

## Development

```sh
pnpm install
pnpm dev        # live dev session in a running Vicinae
pnpm build      # install into Vicinae's extension dir
pnpm test       # unit and integration tests (fake Ente CLI and keychains)
pnpm check      # format and lint
pnpm exec tsc --noEmit
```
