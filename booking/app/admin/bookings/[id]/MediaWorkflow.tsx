import type { ReactNode } from "react";

const PLANNED_FLOW = ["Upload", "Review", "Prepare", "Ready"] as const;

export default function MediaWorkflow({
  hasIGuidePhotos,
  iGuide,
  autoenhance,
  video,
  manualLinks,
}: {
  hasIGuidePhotos: boolean;
  manualUploadEnabled: boolean;
  iGuide: ReactNode;
  autoenhance: ReactNode;
  video: ReactNode;
  manualLinks: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
          Planned delivery flow
        </p>
        <ol
          aria-label="Planned media delivery flow"
          className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PLANNED_FLOW.map((label, index) => (
            <li
              key={label}
              className="rounded-xl border border-realtor-primary/10 bg-white/60 px-3 py-3 text-realtor-muted"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-75">
                Stage {index + 1}
              </span>
              <span className="mt-0.5 block text-sm font-semibold">{label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-realtor-muted">
          This preview shows the proposed structure only. Stages will become live when upload, approval, packaging, and delivery state are connected.
        </p>
      </section>

      <section className="rounded-2xl border border-realtor-primary/20 bg-realtor-primary/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-realtor-primary">
              Primary media source
            </p>
            <h2 className="mt-1 text-lg font-semibold text-realtor-text">
              {hasIGuidePhotos ? "iGUIDE photos connected" : "Manual photo upload"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-realtor-muted">
              {hasIGuidePhotos
                ? "Valid iGUIDE photo downloads remain the delivery source. You can still add video and exceptional links below."
                : "No usable iGUIDE photo package is connected. This is where finished JPG photos will be uploaded once the private production storage and canonical database workflow are enabled."}
            </p>
          </div>
          <span className="rounded-full border border-realtor-primary/15 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary">
            {hasIGuidePhotos ? "iGUIDE preferred" : "Preview only"}
          </span>
        </div>

        {!hasIGuidePhotos ? (
          <div className="mt-4 rounded-2xl border border-dashed border-realtor-primary/25 bg-white/60 p-5 text-center">
            <p className="text-sm font-semibold text-realtor-text">
              Manual JPG upload will appear here
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
              The planned manual/canonical JPG upload is not enabled in this preview. This card has no file selector and cannot send files to private Pixel storage. Existing Autoenhance tools remain available under Advanced source setup.
            </p>
          </div>
        ) : null}
      </section>

      <details className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-realtor-text">
          Advanced source setup
        </summary>
        <p className="mt-2 text-xs text-realtor-muted">
          Connect or repair provider workflows only when the primary source needs attention.
        </p>
        <div className="mt-4 space-y-4">
          {iGuide}
          {autoenhance}
        </div>
      </details>

      <details className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-realtor-text">
          Video and exceptional links
        </summary>
        <div className="mt-4 space-y-4">
          {video}
          {manualLinks}
        </div>
      </details>
    </div>
  );
}
