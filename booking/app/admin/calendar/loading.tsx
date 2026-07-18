import { SkeletonBlock } from "@/app/_components/LoadingSkeleton";

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading calendar"
      className="max-w-full space-y-4 px-0.5"
    >
      <header className="px-1 py-1 md:py-2">
        <SkeletonBlock className="h-3 w-20" />
        <SkeletonBlock className="mt-2 h-9 w-60 max-w-full" />
        <SkeletonBlock className="mt-2 h-4 w-40" />
      </header>

      <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface p-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <SkeletonBlock className="h-11 w-11 rounded-full" />
            <SkeletonBlock className="h-11 w-16 rounded-full" />
            <SkeletonBlock className="h-11 w-11 rounded-full" />
          </div>
          <div className="ml-auto flex gap-1.5">
            <SkeletonBlock className="h-11 w-11 rounded-full" />
            <SkeletonBlock className="h-11 w-11 rounded-full" />
          </div>
        </div>
        <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
        <div className="mt-2 grid grid-cols-7 gap-1 border-t border-realtor-primary/10 pt-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-11 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface p-3 shadow-sm md:hidden">
        <div className="flex items-center justify-between">
          <div>
            <SkeletonBlock className="h-5 w-24" />
            <SkeletonBlock className="mt-2 h-3 w-12" />
          </div>
          <SkeletonBlock className="h-7 w-20 rounded-full" />
        </div>
        <SkeletonBlock className="mt-3 h-[58dvh] min-h-[440px] w-full rounded-2xl" />
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-realtor-primary/10 bg-realtor-surface shadow-sm md:block">
        <div className="grid grid-cols-[64px_repeat(7,minmax(120px,1fr))] gap-px bg-realtor-primary/10">
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-12 rounded-none" />
          ))}
        </div>
        <SkeletonBlock className="h-[58dvh] min-h-[480px] w-full rounded-none" />
      </div>
    </div>
  );
}
