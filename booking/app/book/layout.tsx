import Link from "next/link";
import type { ReactNode } from "react";

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6 md:py-10">
      <header className="max-w-2xl">
        <Link
          href="/"
          className="text-xs text-ink-muted hover:text-white"
        >
          ← Pixel Blaster Media
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-white md:text-3xl">
          Book a shoot
        </h1>
      </header>
      {children}
    </div>
  );
}
