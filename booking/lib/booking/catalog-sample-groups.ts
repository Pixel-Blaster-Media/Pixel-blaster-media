import type { CatalogItemDTO, CatalogItemExampleDTO } from "./catalog-dto";

export interface CatalogSampleGroup {
  key: string;
  label: string;
  examples: CatalogItemExampleDTO[];
}

export const CATALOG_SAMPLE_GROUP_OPTIONS = [
  { key: "photos", label: "Photos" },
  { key: "video", label: "Video" },
  { key: "iguide", label: "iGUIDE" },
  { key: "aerial", label: "Drone" },
] as const;

const VALID_GROUP_KEY = /^[a-z][a-z0-9_]{0,31}$/;

function stableUnicodeKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `u${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
const STANDARD_LABELS = new Map<string, string>(
  CATALOG_SAMPLE_GROUP_OPTIONS.map(({ key, label }) => [key, label]),
);

export function normalizeCatalogSampleGroupInput(
  selectedKey: string,
  customLabel: string,
): { key: string; label: string } | null {
  const standardLabel = STANDARD_LABELS.get(selectedKey);
  if (standardLabel) return { key: selectedKey, label: standardLabel };
  if (selectedKey !== "custom") return null;

  const label = cleanLabel(customLabel);
  if (!label) return null;
  const asciiSlug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const key = `custom_${asciiSlug || stableUnicodeKey(label)}`.slice(0, 32);
  if (!VALID_GROUP_KEY.test(key)) return null;

  return { key, label };
}

export function resolveCatalogSampleGroup(
  example: Pick<
    CatalogItemExampleDTO,
    "kind" | "sample_group_key" | "sample_group_label"
  >,
): { key: string; label: string } {
  const key = example.sample_group_key;
  const label = cleanLabel(example.sample_group_label ?? "");
  if (key && VALID_GROUP_KEY.test(key) && label) return { key, label };
  if (example.kind === "video") return { key: "video", label: "Video" };
  if (example.kind === "interactive") return { key: "iguide", label: "iGUIDE" };
  return { key: "custom", label: "Sample" };
}

export function getCatalogSampleGroups(item: CatalogItemDTO): CatalogSampleGroup[] {
  const groups = new Map<string, CatalogSampleGroup>();
  const addStandard = (enabled: boolean, key: string, label: string) => {
    if (enabled) groups.set(key, { key, label, examples: [] });
  };

  addStandard(item.is_photo, "photos", "Photos");
  addStandard(item.is_video, "video", "Video");
  addStandard(item.is_iguide, "iguide", "iGUIDE");
  addStandard(item.is_aerial, "aerial", "Drone");

  for (const example of item.examples) {
    const resolved = resolveCatalogSampleGroup(example);
    const group = groups.get(resolved.key) ?? {
      key: resolved.key,
      label: resolved.label,
      examples: [],
    };
    group.examples.push(example);
    groups.set(resolved.key, group);
  }

  return Array.from(groups.values());
}

function cleanLabel(value: string): string | null {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 24 || /[\u0000-\u001f\u007f]/.test(label)) return null;
  return label;
}
