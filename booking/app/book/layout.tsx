import Link from "next/link";
import type { ReactNode } from "react";

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="realtor-theme realtor-backdrop -mx-6 -my-12 min-h-screen px-6 py-8 text-realtor-text md:py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="max-w-2xl">
          <Link
            href="/"
            className="text-xs font-semibold text-realtor-muted hover:text-realtor-primary"
          >
            ← Pixel Blaster Media
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-realtor-text md:text-4xl">
            Book a shoot
          </h1>
          <p className="mt-2 max-w-xl text-sm text-realtor-muted">
            Premium real estate media, scheduled without the back-and-forth.
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}
