"use client";

import { useState, useTransition } from "react";

import { archiveProperty, restoreProperty } from "./actions";

export default function ArchiveListingButton({
  propertyId,
  archived,
}: {
  propertyId: string;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !archived &&
            !confirm(
              "Archive this listing? It will be hidden from your active list, but nothing gets deleted.",
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const res = archived
              ? await restoreProperty(propertyId)
              : await archiveProperty(propertyId);
            if (!res.ok) setError(res.error ?? "Could not update listing.");
          });
        }}
        className="rounded-md border border-realtor-primary/20 px-3 py-1.5 text-xs font-semibold text-realtor-muted hover:border-realtor-primary hover:text-realtor-primary disabled:opacity-50"
      >
        {pending ? "Working..." : archived ? "Restore" : "Archive"}
      </button>
      {error ? (
        <p className="mt-1 max-w-[12rem] text-[11px] text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
