import {
  SkeletonBlock,
  SkeletonPanel,
} from "@/app/_components/LoadingSkeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading calendar" className="space-y-4">
      <SkeletonBlock className="h-9 w-56" />
      <SkeletonBlock className="h-10 w-full" />
      {/* Week grid placeholder */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-64 md:h-96" />
        ))}
      </div>
      <SkeletonPanel lines={2} />
    </div>
  );
}
