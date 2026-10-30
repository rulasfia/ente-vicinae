import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import { useFrecency } from "./lib/frecency";
import { ensureIcons, getIconPath } from "./lib/icons";
import { loadSecrets } from "./lib/keyring";
import { codesFor, type Secret } from "./lib/secrets";

const ENTE_PURPLE = "#A400B6";
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Re-renders once per second so codes and countdowns stay current.
const useNow = () => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

export default function Command() {
  const [secrets, setSecrets] = useState<Secret[]>();
  const [icons, setIcons] = useState<Record<string, string | undefined>>({});
  const now = useNow();
  const { sorted, visit, reset } = useFrecency(secrets ?? [], (s) => s.id);
  const prefs = getPreferenceValues<Preferences>();
  const primary = prefs.primaryAction ?? "paste";
  const fetchIcons = prefs.fetchIcons ?? true;

  const loadIcons = async (force = false) => {
    const services = [...new Set((secrets ?? []).map((s) => s.issuer))];
    if (services.length === 0) return;
    setIcons(Object.fromEntries(services.map((s) => [s, getIconPath(s)])));
    if (!fetchIcons) return;
    await ensureIcons(services, force);
    setIcons(Object.fromEntries(services.map((s) => [s, getIconPath(s)])));
  };

  useEffect(() => {
    loadSecrets()
      .then(setSecrets)
      .catch((error) => {
        setSecrets([]);
        showToast({
          style: Toast.Style.Failure,
          title: "Could not load secrets",
          message: errorMessage(error),
        });
      });
  }, []);

  useEffect(() => {
    loadIcons().catch((error) => console.error("Failed to fetch service icons:", error));
  }, [secrets]);

  const refreshIcons = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Refreshing icons" });
    try {
      await loadIcons(true);
      toast.style = Toast.Style.Success;
      toast.title = "Icons refreshed";
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to refresh icons";
      toast.message = errorMessage(error);
    }
  };

  return (
    <List isLoading={secrets === undefined} searchBarPlaceholder="Search accounts" isShowingDetail>
      <List.EmptyView title="No secrets found" description='Run "Import Secrets" first.' />
      {sorted.map((item) => {
        const { current, next, remaining } = codesFor(item, now);
        const copy = (
          <Action.CopyToClipboard
            key="copy"
            title="Copy Current"
            icon={Icon.Key}
            content={current}
            concealed
            onCopy={() => visit(item)}
          />
        );
        const paste = (
          <Action.Paste
            key="paste"
            title="Paste Current"
            icon={Icon.Key}
            content={current}
            onPaste={() => visit(item)}
          />
        );
        const isUrl = /^https?:\/\//.test(item.notes);

        return (
          <List.Item
            key={item.id}
            title={item.issuer}
            subtitle={item.username}
            icon={icons[item.issuer] ?? Icon.Key}
            keywords={[item.username, ...item.tags]}
            accessories={[
              {
                text: {
                  value: `${remaining}s`,
                  color: remaining > 10 ? Color.Purple : Color.Orange,
                },
              },
            ]}
            detail={
              <List.Item.Detail
                markdown={`# ${current}\n\nNext \`${next}\` in ${remaining}s`}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Username" text={item.username} />
                    <List.Item.Detail.Metadata.Label title="Algorithm" text={item.algorithm} />
                    <List.Item.Detail.Metadata.Label title="Digits" text={String(item.digits)} />
                    <List.Item.Detail.Metadata.Label title="Period" text={`${item.period}s`} />
                    {item.notes && <List.Item.Detail.Metadata.Separator />}
                    {item.notes &&
                      (isUrl ? (
                        <List.Item.Detail.Metadata.Link
                          title="Notes"
                          target={item.notes}
                          text={item.notes}
                        />
                      ) : (
                        <List.Item.Detail.Metadata.Label title="Notes" text={item.notes} />
                      ))}
                    {item.tags.length > 0 && (
                      <List.Item.Detail.Metadata.TagList title="Tags">
                        {item.tags.map((tag) => (
                          <List.Item.Detail.Metadata.TagList.Item
                            key={tag}
                            text={tag}
                            color={ENTE_PURPLE}
                          />
                        ))}
                      </List.Item.Detail.Metadata.TagList>
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Current">
                  {primary === "copy" ? [copy, paste] : [paste, copy]}
                </ActionPanel.Section>
                <ActionPanel.Section title="Next">
                  <Action.CopyToClipboard
                    title="Copy Next"
                    icon={Icon.Key}
                    content={next}
                    concealed
                    shortcut={Keyboard.Shortcut.Common.New}
                    onCopy={() => visit(item)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Reset Ranking"
                    icon={Icon.ArrowCounterClockwise}
                    onAction={() => reset(item)}
                  />
                  {fetchIcons && (
                    <Action
                      title="Refresh Icons"
                      icon={Icon.Image}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={refreshIcons}
                    />
                  )}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
