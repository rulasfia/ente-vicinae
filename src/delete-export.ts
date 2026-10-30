import { Alert, confirmAlert, showToast, Toast } from "@vicinae/api";
import { listBackups, removeExportFiles, resolveExportDir } from "./lib/ente";

export default async function Command() {
  try {
    const dir = await resolveExportDir();
    const backups = listBackups(dir);
    const confirmed = await confirmAlert({
      title: "Delete plaintext exports?",
      message:
        `ente_auth.txt` +
        (backups.length > 0 ? ` and ${backups.length} CLI backup copies` : "") +
        ` in ${dir}`,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const removed = await removeExportFiles(dir, backups);
    await showToast({
      style: Toast.Style.Success,
      title: removed > 0 ? `Deleted ${removed} export files` : "No export files found",
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Delete failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
