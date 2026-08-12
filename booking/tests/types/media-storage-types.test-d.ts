import { buildMasterKey, type MediaObjectKey } from "../../lib/media/storage/keys.ts";
import type { R2Storage } from "../../lib/media/storage/r2-core.ts";

const key = buildMasterKey(
  "11111111-1111-4111-8111-111111111111",
  "41111111-1111-4111-8111-111111111111",
  "51111111-1111-4111-8111-111111111111",
  "a".repeat(64),
  "jpg",
);

const brandedKey: MediaObjectKey = key;
void brandedKey;

// @ts-expect-error Unvalidated caller strings cannot become canonical media object keys.
const rawKey: MediaObjectKey = "masters/unvalidated";
void rawKey;

declare const storage: R2Storage;
void storage.head(key);
// @ts-expect-error Storage operations require a key returned by a canonical parser or builder.
void storage.head("masters/unvalidated");
