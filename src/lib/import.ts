import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { lastLogLine, prepareExportDir, removeExportFiles, runExport } from "./ente";
import { saveSecrets } from "./keyring";
import { EXPORT_FILE } from "./paths";
import { parseSecrets } from "./secrets";

export type ImportResult = {
  count: number;
  skipped: number;
  /** Set when the CLI export failed and an older export file was imported instead. */
  stale?: { exportedAt: Date; reason: string };
};

/**
 * Exports from the Ente CLI and replaces the stored secrets, so accounts added, edited or deleted
 * elsewhere (e.g. on a phone) are reflected. Stored secrets are left untouched when nothing usable
 * was exported. With `deleteAfter`, removes ente_auth.txt and any backups the CLI made this run.
 */
export const importSecrets = async (deleteAfter: boolean): Promise<ImportResult> => {
  const dir = await prepareExportDir();
  const file = path.join(dir, EXPORT_FILE);
  let createdBackups: string[] = [];

  try {
    let failure: string | undefined;
    try {
      const result = await runExport(dir);
      createdBackups = result.createdBackups;
      if (!result.written) {
        failure = `Ente CLI wrote no export (${lastLogLine(result.log) || "no output"})`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const existing = await stat(file).catch(() => undefined);
    if (failure && !existing) throw new Error(`${failure}. Stored secrets were left unchanged.`);

    const { secrets, skipped } = parseSecrets(await readFile(file, "utf8"));
    if (secrets.length === 0) {
      throw new Error("The export contains no TOTP accounts. Stored secrets were left unchanged.");
    }
    await saveSecrets(secrets);

    return {
      count: secrets.length,
      skipped,
      stale: failure && existing ? { exportedAt: existing.mtime, reason: failure } : undefined,
    };
  } finally {
    if (deleteAfter) await removeExportFiles(dir, createdBackups);
  }
};
