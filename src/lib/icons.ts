import { environment, LocalStorage } from "@vicinae/api";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ENTE_ICONS_BASE =
  "https://raw.githubusercontent.com/ente-io/ente/refs/heads/main/mobile/apps/auth/assets/custom-icons/";
const ENTE_ICONS_DATABASE_URL = `${ENTE_ICONS_BASE}_data/custom-icons.json`;
const SIMPLE_ICONS_CDN_URL = "https://cdn.simpleicons.org/";

const iconsDir = () => path.join(environment.supportPath, "service_icons");

// Services with no icon found, so lookups aren't repeated every launch. Bump the key when matching changes.
const MISSES_KEY = "icon-misses-v2";
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type EnteIcon = { title: string; slug?: string; altNames?: string[] };
// `transient` marks a retryable failure (network, rate limit, 5xx) that must not be cached as a miss.
type Outcome = { svg: string | null; transient: boolean };

const NOT_FOUND: Outcome = { svg: null, transient: false };

// Readable slug plus a short hash, so names that slugify alike (e.g. non-Latin ones) never collide.
const iconFileName = (service: string) => {
  const slug = service
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hash = createHash("sha256").update(service).digest("hex").slice(0, 8);
  return `${slug || "icon"}-${hash}.svg`;
};

const MAX_SVG_BYTES = 512 * 1024;

// Name variants, most specific first: full name, without parentheticals, then shorter word prefixes
// (so "Terraform Cloud" can fall back to "Terraform").
const nameCandidates = (service: string) => {
  const withoutParens = service
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = withoutParens.split(" ");
  const all = [
    service.trim(),
    withoutParens,
    ...words.map((_, i) => words.slice(0, words.length - 1 - i).join(" ")),
  ];
  return [...new Map(all.filter(Boolean).map((name) => [name.toLowerCase(), name])).values()];
};

const iconFile = (service: string) => path.join(iconsDir(), iconFileName(service));

/** Path to a service's cached icon, or undefined if not downloaded yet. */
export const getIconPath = (service: string) => {
  const file = service ? iconFile(service) : "";
  return file && existsSync(file) ? file : undefined;
};

const fetchSvg = async (url: string): Promise<Outcome> => {
  try {
    const response = await fetch(url);
    if (response.status === 404) return NOT_FOUND;
    if (!response.ok) return { svg: null, transient: true };
    const svg = await response.text();
    if (svg.length > MAX_SVG_BYTES) return NOT_FOUND;
    return svg.includes("<svg") ? { svg, transient: false } : NOT_FOUND;
  } catch {
    return { svg: null, transient: true };
  }
};

// Fetched once per session; only cached on success so failures retry next run.
let enteDatabase: EnteIcon[] | null = null;

const fetchEnteIcon = async (service: string): Promise<Outcome> => {
  if (!enteDatabase) {
    try {
      const response = await fetch(ENTE_ICONS_DATABASE_URL);
      if (!response.ok) return { svg: null, transient: true };
      enteDatabase = ((await response.json()) as { icons?: EnteIcon[] }).icons ?? [];
    } catch {
      return { svg: null, transient: true };
    }
  }

  for (const candidate of nameCandidates(service)) {
    const needle = candidate.toLowerCase();
    const match = enteDatabase.find((icon) =>
      [icon.title, icon.slug ?? "", ...(icon.altNames ?? [])].some(
        (name) => name.toLowerCase() === needle,
      ),
    );
    if (match) {
      const name = match.slug || match.title.toLowerCase();
      return fetchSvg(`${ENTE_ICONS_BASE}icons/${encodeURIComponent(name)}.svg`);
    }
  }
  return NOT_FOUND;
};

const fetchSimpleIcon = async (service: string): Promise<Outcome> => {
  let transient = false;
  const slugs = new Set(
    nameCandidates(service).map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  for (const slug of slugs) {
    if (!slug) continue;
    const outcome = await fetchSvg(`${SIMPLE_ICONS_CDN_URL}${slug}`);
    if (outcome.svg) return outcome;
    transient ||= outcome.transient;
  }
  return { svg: null, transient };
};

/**
 * Downloads icons for services without a cached one (Ente registry first, then Simple Icons).
 * Definitive misses are remembered for a week; `force` ignores both caches.
 */
export const ensureIcons = async (services: string[], force = false) => {
  const unique = [...new Set(services.filter(Boolean))];
  if (unique.length === 0) return;

  await mkdir(iconsDir(), { recursive: true });
  let misses: Record<string, number> = {};
  try {
    misses = JSON.parse((await LocalStorage.getItem<string>(MISSES_KEY)) ?? "{}");
  } catch {
    // Corrupt cache; start over.
  }
  let changed = false;

  for (const service of unique) {
    const recentMiss = Date.now() - (misses[service] ?? 0) < MISS_TTL_MS;
    if (!force && (existsSync(iconFile(service)) || recentMiss)) continue;

    const ente = await fetchEnteIcon(service);
    const simple = ente.svg ? null : await fetchSimpleIcon(service);
    const svg = ente.svg ?? simple?.svg;

    if (svg) {
      await writeFile(iconFile(service), svg);
      if (service in misses) delete misses[service];
    } else if (!ente.transient && !simple?.transient) {
      misses[service] = Date.now();
    }
    changed = true;
  }

  if (changed) await LocalStorage.setItem(MISSES_KEY, JSON.stringify(misses));
};
