"use client";

import {
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  Smartphone,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "./push-actions";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallAppCard({
  publicKey,
  configured,
}: {
  publicKey: string | null;
  configured: boolean;
}) {
  const [standalone, setStandalone] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setStandalone(isStandalone);
    setPushSupported(
      "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);

    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then(setSubscription)
        .catch(() => setSubscription(null));
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const install = () => {
    if (!installPrompt) return;
    startTransition(async () => {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setStandalone(true);
        setMessage("App installed. You can open it from your Home Screen.");
      }
      setInstallPrompt(null);
    });
  };

  const enableNotifications = () => {
    if (!publicKey || !configured) {
      setMessage("Notification keys still need to be configured.");
      return;
    }
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage("Notifications were not allowed on this device.");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const next =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToArrayBuffer(publicKey),
          }));
        const json = next.toJSON();
        const result = await savePushSubscription(
          {
            endpoint: next.endpoint,
            keys: {
              p256dh: json.keys?.p256dh ?? "",
              auth: json.keys?.auth ?? "",
            },
          },
          navigator.userAgent,
        );
        if (!result.ok) {
          setMessage(result.error ?? "Could not save this device.");
          return;
        }
        setSubscription(next);
        setMessage("Notifications are on for this device.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not enable notifications.",
        );
      }
    });
  };

  const disableNotifications = () => {
    if (!subscription) return;
    startTransition(async () => {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const result = await removePushSubscription(endpoint);
      if (!result.ok) {
        setMessage(result.error ?? "Could not remove this device.");
        return;
      }
      setSubscription(null);
      setMessage("Notifications are off for this device.");
    });
  };

  const testNotification = () => {
    startTransition(async () => {
      const result = await sendTestPush();
      setMessage(
        result.ok
          ? "Test sent. It should appear in a moment."
          : result.error ?? "The test notification failed.",
      );
    });
  };

  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-lg shadow-realtor-text/10">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-realtor-primary/10 text-realtor-primary">
          <Smartphone aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary/80">
            Mobile app
          </p>
          <h2 className="mt-1 text-xl font-semibold text-realtor-text">
            Install and notify this phone
          </h2>
          <p className="mt-1 text-sm leading-6 text-realtor-muted">
            Open the admin calendar from your Home Screen and receive important
            booking updates on this device.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 border-t border-realtor-primary/10 pt-5 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-realtor-text">
            {standalone ? (
              <CheckCircle2 className="h-4 w-4 text-realtor-primary" />
            ) : (
              <Download className="h-4 w-4 text-realtor-primary" />
            )}
            {standalone ? "Installed on this device" : "Add to Home Screen"}
          </div>
          {!standalone ? (
            <ol className="mt-3 space-y-1.5 text-xs leading-5 text-realtor-muted">
              <li>iPhone: open the live site in Safari and tap Share.</li>
              <li>Choose Add to Home Screen, then turn on Open as Web App.</li>
              <li>Android: open the browser menu and choose Install app.</li>
            </ol>
          ) : null}
          {installPrompt && !standalone ? (
            <button
              type="button"
              disabled={pending}
              onClick={install}
              className="mt-3 rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              Install app
            </button>
          ) : null}
        </div>

        <div className="md:border-l md:border-realtor-primary/10 md:pl-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-realtor-text">
            {subscription ? (
              <Bell className="h-4 w-4 text-realtor-primary" />
            ) : (
              <BellOff className="h-4 w-4 text-realtor-muted" />
            )}
            {subscription ? "Notifications are on" : "App notifications"}
          </div>
          {!configured ? (
            <p className="mt-2 text-xs leading-5 text-realtor-muted">
              App notifications will be available after the notification keys
              are added to this deployment.
            </p>
          ) : !pushSupported ? (
            <p className="mt-2 text-xs leading-5 text-realtor-muted">
              This browser does not support app notifications.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={subscription ? disableNotifications : enableNotifications}
                className="rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {subscription ? "Turn off" : "Turn on"}
              </button>
              {subscription ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={testNotification}
                  className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-xs font-semibold text-realtor-primary disabled:opacity-60"
                >
                  Send test
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-realtor-primary/10 bg-white/70 px-3 py-2 text-xs text-realtor-text" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}
