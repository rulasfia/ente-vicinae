import { LocalStorage } from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";

const KEY = "frecency-v1";
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { score: number; at: number };
type Scores = Record<string, Entry>;

// Score halves every week without use, so recent habits outrank old ones.
const decayed = (entry: Entry | undefined, now: number) =>
  entry ? entry.score * 0.5 ** ((now - entry.at) / HALF_LIFE_MS) : 0;

/**
 * Stand-in for @raycast/utils `useFrecencySorting`: orders items by decayed use count.
 * `visit` records a use, `reset` forgets an item.
 */
export const useFrecency = <T>(items: T[], key: (item: T) => string) => {
  const [scores, setScores] = useState<Scores>({});

  useEffect(() => {
    LocalStorage.getItem<string>(KEY)
      .then((raw) => raw && setScores(JSON.parse(raw)))
      .catch((error) => console.error("Failed to load frecency:", error));
  }, []);

  const update = useCallback((change: (prev: Scores) => Scores) => {
    setScores((prev) => {
      const next = change(prev);
      LocalStorage.setItem(KEY, JSON.stringify(next)).catch(console.error);
      return next;
    });
  }, []);

  const now = Date.now();
  const sorted = [...items].sort(
    (a, b) => decayed(scores[key(b)], now) - decayed(scores[key(a)], now),
  );

  const visit = (item: T) =>
    update((prev) => ({
      ...prev,
      [key(item)]: { score: decayed(prev[key(item)], Date.now()) + 1, at: Date.now() },
    }));

  const reset = (item: T) =>
    update((prev) => {
      const { [key(item)]: _, ...rest } = prev;
      return rest;
    });

  return { sorted, visit, reset };
};
