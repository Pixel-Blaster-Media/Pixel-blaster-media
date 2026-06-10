import type { ReactNode } from "react";

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="booking-shell realtor-theme realtor-backdrop min-h-screen overflow-x-hidden px-4 py-5 text-realtor-text sm:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>
    </div>
  );
}
