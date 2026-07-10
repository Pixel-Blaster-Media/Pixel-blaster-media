"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

const CURRENT_USER_KEY = "pixel-booking:current-user";

export default function PwaClient({ userId }: { userId: string | null }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch((error) =>
            console.warn("[pwa] service worker registration failed", error),
          );
      } else {
        // A production worker on localhost can retain old Next.js chunks and
        // make freshly compiled Server Actions look missing. Keep local
        // development cache-free while preserving the production app.
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations
                .filter((registration) =>
                  registration.active?.scriptURL.endsWith("/sw.js"),
                )
                .map((registration) => registration.unregister()),
            ),
          )
          .catch(() => undefined);
        if ("caches" in window) {
          window.caches
            .keys()
            .then((keys) =>
              Promise.all(
                keys
                  .filter((key) => key.startsWith("pixel-booking-"))
                  .map((key) => window.caches.delete(key)),
              ),
            )
            .catch(() => undefined);
        }
      }
    }

    const previousUserId = window.localStorage.getItem(CURRENT_USER_KEY);
    if (previousUserId && previousUserId !== userId) {
      window.localStorage.removeItem(`pixel-booking:offline-today:${previousUserId}`);
    }
    if (userId) {
      window.localStorage.setItem(CURRENT_USER_KEY, userId);
    } else {
      if (previousUserId) {
        window.localStorage.removeItem(`pixel-booking:offline-today:${previousUserId}`);
      }
      window.localStorage.removeItem(CURRENT_USER_KEY);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [userId]);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[200] mx-auto flex max-w-md items-center gap-2 rounded-lg border border-amber-700/25 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 shadow-xl"
    >
      <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
      Offline mode is read-only. Reconnect before making changes.
    </div>
  );
}
