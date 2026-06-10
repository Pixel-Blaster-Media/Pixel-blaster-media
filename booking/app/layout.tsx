import type { Metadata, Viewport } from "next";
import Link from "next/link";
import AuthSessionHandler from "./AuthSessionHandler";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pixel Booking — Real Estate Media Platform",
    template: "%s · Pixel Booking",
  },
  description:
    "Real estate media booking, delivery, listing websites, and client portals for photography companies and realtors.",
  robots: {
    // Keep the standalone booking app out of search while it lives on a
    // temporary Vercel URL. Flip this on once the public domain is ready.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#0b0f10",
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
        <header className="site-header border-b border-white/5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
            <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold">
              <span className="site-brand-primary text-white">
                Pixel
              </span>
              <span className="site-brand-accent text-brand-light">
                Booking
              </span>
            </Link>
            <nav className="site-nav flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted md:gap-6">
              <Link href="/start" className="hover:text-white">
                Sign up
              </Link>
              <Link href="/auth/sign-in?next=/admin" className="hover:text-white">
                Sign in
              </Link>
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
        <main className="site-main mx-auto max-w-6xl px-6 py-12">
          {children}
        </main>
        <footer className="site-footer mt-24 border-t border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-8 text-xs text-ink-muted md:flex-row md:items-center">
            <p>
              © {new Date().getFullYear()} Pixel Blaster Media · Hamilton, ON ·
              Greater Toronto Area
            </p>
            <p>
              Platform beta —{" "}
              <span className="text-ink-muted/70">
                booking, delivery, and listing tools
              </span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
