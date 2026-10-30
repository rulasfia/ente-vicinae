import { getPreferenceValues, showToast, Toast } from "@vicinae/api";
import { hasEnteCli } from "./lib/ente";
import { importSecrets } from "./lib/import";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Importing secrets" });

  if (!(await hasEnteCli())) {
    toast.style = Toast.Style.Failure;
    toast.title = "Ente CLI not found";
    toast.message = "Install it or set its path in preferences";
    return;
  }

  try {
    const { count, skipped, stale } = await importSecrets(
      getPreferenceValues<Preferences>().deleteExport ?? true,
    );
    const skippedNote = skipped > 0 ? `${skipped} unsupported or invalid entries skipped` : "";

    if (stale) {
      toast.style = Toast.Style.Failure;
      toast.title = `Export failed, imported ${count} from an older file`;
      toast.message = [`File from ${stale.exportedAt.toLocaleString()}`, stale.reason, skippedNote]
        .filter(Boolean)
        .join(". ");
      return;
    }
    toast.style = Toast.Style.Success;
    toast.title = `${count} secrets imported`;
    toast.message = skippedNote;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Import failed";
    toast.message = error instanceof Error ? error.message : String(error);
  }
}
