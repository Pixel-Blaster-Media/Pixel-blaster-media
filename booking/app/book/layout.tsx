import type { ReactNode } from "react";

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="booking-shell realtor-theme realtor-backdrop min-h-screen overflow-x-hidden px-4 py-6 text-realtor-text sm:px-6 md:py-12">
      <div className="mx-auto max-w-4xl space-y-6 pb-28 md:pb-0">
        {children}
      </div>
    </div>
  );
}
