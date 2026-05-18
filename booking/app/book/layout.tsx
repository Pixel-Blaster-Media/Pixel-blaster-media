import type { ReactNode } from "react";

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="booking-shell realtor-theme realtor-backdrop -mx-6 -my-12 min-h-screen px-6 py-8 text-realtor-text md:py-12">
      <div className="mx-auto max-w-4xl space-y-6 pb-28 md:pb-0">
        {children}
      </div>
    </div>
  );
}
