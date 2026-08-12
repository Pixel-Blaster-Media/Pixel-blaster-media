import type { MediaObjectKey } from "./keys.ts";

interface CleanupHead {
  etag: string | null;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function combineLiveProbeFailures(
  primaryFailure: unknown,
  cleanupFailure: unknown,
): unknown {
  if (!primaryFailure) return cleanupFailure;
  if (!cleanupFailure) return primaryFailure;
  return new AggregateError(
    [primaryFailure, cleanupFailure],
    "R2 development probe and final cleanup both failed",
    { cause: primaryFailure },
  );
}

export async function cleanupSyntheticQuarantineObjects({
  keys,
  head,
  remove,
}: {
  keys: Iterable<MediaObjectKey>;
  head: (key: MediaObjectKey) => Promise<CleanupHead>;
  remove: (key: MediaObjectKey, expectedEtag: string) => Promise<void>;
}): Promise<{ removed: number; absent: number; unresolved: string[] }> {
  let removed = 0;
  let absent = 0;
  const unresolved: string[] = [];

  for (const key of keys) {
    try {
      const object = await head(key);
      if (!object.etag) {
        unresolved.push(key.slice(-36));
        continue;
      }
      await remove(key, object.etag);
      removed++;
    } catch (error) {
      if (isMissingObject(error)) {
        absent++;
      } else {
        unresolved.push(key.slice(-36));
      }
    }
  }

  return { removed, absent, unresolved };
}
