import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Book Real Estate Media",
  description:
    "Book real estate photography, video, iGuide virtual tours, and floor plans online with Pixel Blaster Media — serving Hamilton and the Greater Toronto Area.",
  // The booking flow is public and reaches this app through the marketing
  // project's Vercel rewrites. Keep search engines and user-facing links on
  // the configured apex application origin instead of an internal Vercel host.
  // Admin/portal/auth remain noindex via the root layout.
  robots: { index: true, follow: true },
  alternates: { canonical: "https://pixelblastermedia.com/book" },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fbfcfa",
};

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="booking-shell realtor-theme realtor-backdrop min-h-screen overflow-x-hidden px-4 py-5 text-realtor-text sm:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
        <footer className="flex items-center justify-center border-t border-realtor-primary/10 pt-5 text-xs text-realtor-muted">
          <span>Already booked?</span>
          <Link
            href="/auth/sign-in?audience=realtor&next=/portal"
            className="ml-1.5 font-semibold text-realtor-primary hover:underline"
          >
            Open client portal
          </Link>
        </footer>
      </div>
    </div>
  );
}
