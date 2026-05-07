"use client";

import { useState, type ReactNode } from "react";

type WorkspaceTabId = "overview" | "media" | "website" | "delivery" | "billing";

interface WorkspaceTab {
  id: WorkspaceTabId;
  label: string;
  helper: string;
  content: ReactNode;
}

export default function BookingWorkspaceTabs({
  overview,
  media,
  website,
  delivery,
  billing,
}: {
  overview: ReactNode;
  media: ReactNode;
  website: ReactNode;
  delivery: ReactNode;
  billing: ReactNode;
}) {
  const [active, setActive] = useState<WorkspaceTabId>("overview");
  const tabs: WorkspaceTab[] = [
    {
      id: "overview",
      label: "Overview",
      helper: "Status, cancellation, and the next job move.",
      content: overview,
    },
    {
      id: "media",
      label: "Media",
      helper: "Photos, video links, iGUIDE, and manual media links.",
      content: media,
    },
    {
      id: "website",
      label: "Website",
      helper: "Template, listing copy, contact details, and publish state.",
      content: website,
    },
    {
      id: "delivery",
      label: "Delivery",
      helper: "Preview links and send or resend the realtor email.",
      content: delivery,
    },
    {
      id: "billing",
      label: "Billing",
      helper: "QuickBooks creation and invoice status.",
      content: billing,
    },
  ];
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-ink-soft/50 p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={`rounded-xl px-3 py-3 text-left transition ${
                  selected
                    ? "bg-brand text-white shadow-sm"
                    : "text-ink-muted hover:bg-white/5 hover:text-white"
                }`}
                aria-pressed={selected}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span
                  className={`mt-1 block text-xs ${
                    selected ? "text-white/80" : "text-ink-muted"
                  }`}
                >
                  {tab.helper}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section aria-label={`${activeTab.label} workspace`} className="space-y-4">
        {activeTab.content}
      </section>
    </div>
  );
}
