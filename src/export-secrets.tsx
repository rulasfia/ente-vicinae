import { Detail } from "@vicinae/api";
import { readFile } from "node:fs/promises";
import { useEffect, useState } from "react";
import { CliMissing } from "./components/cli-missing";
import { hasEnteCli, lastLogLine, prepareExportDir, runExport } from "./lib/ente";
import { parseSecrets } from "./lib/secrets";

type State = { status: "loading" } | { status: "no-cli" } | { status: "done"; markdown: string };

export default function Command() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    (async () => {
      if (!(await hasEnteCli())) return setState({ status: "no-cli" });
      try {
        const { file, written, log } = await runExport(await prepareExportDir());
        if (!written)
          throw new Error(`Ente CLI wrote no export (${lastLogLine(log) || "no output"})`);
        const { secrets, skipped } = parseSecrets(await readFile(file, "utf8"));
        const list = secrets.map((s) => `- ${s.issuer} \`${s.username}\``).join("\n");
        const skippedNote = skipped > 0 ? `\n\n${skipped} unsupported or invalid entries.` : "";
        setState({
          status: "done",
          markdown:
            `## ${secrets.length} secrets exported to \`${file}\`\n\n` +
            `The file is plaintext. Run **Delete Export** when done.${skippedNote}\n\n${list}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState({ status: "done", markdown: `## Export failed\n\n${message}` });
      }
    })();
  }, []);

  if (state.status === "no-cli") return <CliMissing />;
  return (
    <Detail
      isLoading={state.status === "loading"}
      markdown={state.status === "done" ? state.markdown : ""}
    />
  );
}
