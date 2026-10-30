import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  openExtensionPreferences,
} from "@vicinae/api";

const CLI_GUIDE_URL = "https://github.com/ente-io/ente/tree/main/cli#readme";

/** Shown when the configured Ente CLI can't be executed. */
export const CliMissing = () => (
  <Detail
    markdown={[
      "# Ente CLI not found",
      `Could not run \`${getPreferenceValues<Preferences>().cliPath || "ente"}\`.`,
      `Install the [Ente CLI](${CLI_GUIDE_URL}), run \`ente account add\` with app \`auth\`, then set the path in preferences.`,
    ].join("\n\n")}
    actions={
      <ActionPanel>
        <Action.OpenInBrowser title="Open CLI Guide" url={CLI_GUIDE_URL} />
        <Action
          title="Open Extension Preferences"
          icon={Icon.Cog}
          onAction={openExtensionPreferences}
        />
      </ActionPanel>
    }
  />
);
