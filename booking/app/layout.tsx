import type { Metadata } from "next";
import Link from "next/link";
import AuthSessionHandler from "./AuthSessionHandler";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pixel Blaster Media — Booking & Client Portal",
    template: "%s · Pixel Blaster Media",
  },
  description:
    "Book real estate photography, iGuide virtual tours, and floor plans with Pixel Blaster Media. Realtors: access photos, tours, and deliverables in one place.",
  robots: {
    // Keep the standalone booking app out of search while it lives on a
    // temporary Vercel URL. Flip this on once the public domain is ready.
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen page-backdrop">
        <AuthSessionHandler />
        <header className="border-b border-white/5">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="text-white">Pixel Blaster</span>
              <span className="text-brand-light">Booking</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-ink-muted">
              <Link href="/book" className="hover:text-white">
                Book
              </Link>
              <Link href="/portal" className="hover:text-white">
                Client Portal
              </Link>
              <a
                href="https://www.pixelblastermedia.com"
                className="hover:text-white"
              >
                Main Site ↗
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-12">{children}</main>
        <footer className="mt-24 border-t border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-8 text-xs text-ink-muted md:flex-row md:items-center">
            <p>
              © {new Date().getFullYear()} Pixel Blaster Media · Hamilton, ON ·
              Greater Toronto Area
            </p>
            <p>
              Booking portal —{" "}
              <span className="text-ink-muted/70">client booking + delivery</span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
