import type { Metadata } from "next";

import BookingForm from "./BookingForm";

export const metadata: Metadata = {
  title: "Book a Shoot",
  description:
    "Request a real estate photography, iGuide virtual tour, or floor plan shoot with Pixel Blaster Media.",
};

export default function BookPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Realtors · Hamilton & GTA
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">
          Book a shoot
        </h1>
        <p className="mt-3 text-ink-muted">
          Tell us what you need and when. We confirm the date by email within
          24 hours. No payment is taken at booking.
        </p>
      </header>

      <BookingForm />
    </div>
  );
}
