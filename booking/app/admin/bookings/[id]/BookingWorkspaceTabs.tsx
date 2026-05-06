"use client";

import { useState, type ReactNode } from "react";

type WorkspaceTabId = "job" | "media" | "invoice";

interface WorkspaceTab {
  id: WorkspaceTabId;
  label: string;
  helper: string;
  content: ReactNode;
}

export default function BookingWorkspaceTabs({
  job,
  media,
  invoice,
}: {
  job: ReactNode;
  media: ReactNode;
  invoice: ReactNode;
}) {
  const [active, setActive] = useState<WorkspaceTabId>("job");
  const tabs: WorkspaceTab[] = [
    {
      id: "job",
      label: "Job",
      helper: "Status, delivery email, and day-to-day controls.",
      content: job,
    },
    {
      id: "media",
      label: "Media",
      helper: "Fotello, video links, iGUIDE, floor plans, and tour sync.",
      content: media,
    },
    {
      id: "invoice",
      label: "Invoice",
      helper: "QuickBooks creation and invoice status.",
      content: invoice,
    },
  ];
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-2">
        <div className="grid gap-2 sm:grid-cols-3">
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={`rounded-md px-3 py-3 text-left transition ${
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
