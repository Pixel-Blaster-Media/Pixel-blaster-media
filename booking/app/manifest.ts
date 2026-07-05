import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes the platform installable from the browser
 * ("Add to Home Screen") so the admin launches full-screen like a
 * native app. start_url goes to /admin: signed-in admins land on their
 * dashboard, everyone else hits the normal sign-in redirect.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pixel Blaster Booking",
    short_name: "PB Booking",
    description:
      "Real estate media booking, delivery, and client portals.",
    start_url: "/admin",
    display: "standalone",
    background_color: "#f4f7f2",
    theme_color: "#3f7356",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
