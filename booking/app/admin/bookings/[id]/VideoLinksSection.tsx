"use client";

import { useState, useTransition } from "react";

import { addManualDeliverable } from "./actions";

export default function VideoLinksSection({ bookingId }: { bookingId: string }) {
  return (
    <div className="space-y-4 rounded-2xl border border-brand/20 bg-brand/5 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-light">
          Video
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Add a downloadable video file and/or a YouTube/Vimeo viewing link.
          Both show clearly in the realtor portal and delivery email.
        </p>
      </div>
      <div className="grid gap-3 2xl:grid-cols-2">
        <VideoLinkForm
          bookingId={bookingId}
          deliveryKind="download"
          deliveryLabel="Video download"
          title="Download file"
          helper="Dropbox, Google Drive, WeTransfer, or a direct video file."
          placeholder="https://dropbox.com/... or https://drive.google.com/..."
          buttonLabel="Add download"
        />
        <VideoLinkForm
          bookingId={bookingId}
          deliveryKind="streaming"
          deliveryLabel="YouTube / video link"
          title="YouTube / viewing link"
          helper="YouTube, Vimeo, Matterport-style video page, or social video link."
          placeholder="https://youtube.com/watch?v=..."
          buttonLabel="Add YouTube link"
        />
      </div>
    </div>
  );
}

function VideoLinkForm({
  bookingId,
  deliveryKind,
  deliveryLabel,
  title,
  helper,
  placeholder,
  buttonLabel,
}: {
  bookingId: string;
  deliveryKind: "download" | "streaming";
  deliveryLabel: string;
  title: string;
  helper: string;
  placeholder: string;
  buttonLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  return (
    <form
      id={`video-link-${deliveryKind}-${bookingId}`}
      className="min-w-0 rounded-2xl border border-white/10 bg-ink/30 p-3"
      action={(formData) => {
        setError(null);
        setOkMessage(null);
        startTransition(async () => {
          const res = await addManualDeliverable(bookingId, formData);
          if (!res.ok) {
            setError(res.error ?? "Could not add video link.");
            return;
          }
          setOkMessage(`${deliveryLabel} added.`);
          (document.getElementById(
            `video-link-${deliveryKind}-${bookingId}`,
          ) as HTMLFormElement | null)?.reset();
        });
      }}
    >
      <input type="hidden" name="type" value="video" />
      <input type="hidden" name="delivery_kind" value={deliveryKind} />
      <input type="hidden" name="delivery_label" value={deliveryLabel} />
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="mt-1 text-[11px] text-ink-muted">{helper}</p>
      <div className="mt-2 grid gap-2">
        <input
          name="url"
          type="url"
          placeholder={placeholder}
          required
          className="min-w-0 rounded-xl border border-white/10 bg-ink-soft px-3 py-2 text-sm text-white"
        />
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
        >
          {isPending ? "Adding..." : buttonLabel}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="mt-2 text-xs text-emerald-300">{okMessage}</p>
      ) : null}
    </form>
  );
}
