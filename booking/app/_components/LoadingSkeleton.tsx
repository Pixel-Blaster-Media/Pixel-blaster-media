/**
 * Shared loading skeletons for route-level loading.tsx files.
 *
 * Both the admin (earth theme) and the public booking/portal flows
 * (realtor theme) are light, so one neutral pulse style works
 * everywhere: soft green-tinted blocks matching the realtor palette.
 */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-2xl bg-realtor-primary/10 ${className}`}
    />
  );
}

export function SkeletonPanel({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-3xl border border-realtor-primary/10 bg-realtor-surface/70 p-4 md:p-5 ${className}`}
    >
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-1/3 rounded-full bg-realtor-primary/10" />
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded-full bg-realtor-primary/10"
            style={{ width: `${85 - i * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ panels = 3 }: { panels?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <SkeletonBlock className="h-9 w-48" />
      {Array.from({ length: panels }).map((_, i) => (
        <SkeletonPanel key={i} lines={3} />
      ))}
    </div>
  );
}
