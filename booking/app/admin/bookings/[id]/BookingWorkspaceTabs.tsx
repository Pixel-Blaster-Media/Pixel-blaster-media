import Link from "next/link";
import type { ReactNode } from "react";

export type WorkspaceTabId =
  | "media"
  | "website"
  | "delivery"
  | "billing"
  | "details";

interface WorkspaceTab {
  id: WorkspaceTabId;
  label: string;
  content: ReactNode;
}

export default function BookingWorkspaceTabs({
  activeTabId,
  baseHref,
  media,
  website,
  delivery,
  billing,
  details,
}: {
  activeTabId: WorkspaceTabId;
  baseHref: string;
  media: ReactNode;
  website: ReactNode;
  delivery: ReactNode;
  billing: ReactNode;
  details: ReactNode;
}) {
  const tabs: WorkspaceTab[] = [
    {
      id: "media",
      label: "Media",
      content: media,
    },
    {
      id: "website",
      label: "Custom page",
      content: website,
    },
    {
      id: "delivery",
      label: "Delivery",
      content: delivery,
    },
    {
      id: "billing",
      label: "Billing",
      content: billing,
    },
    {
      id: "details",
      label: "Details",
      content: details,
    },
  ];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-ink-soft/50 p-2">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <Link
                key={tab.id}
                href={tab.id === "media" ? baseHref : `${baseHref}?tab=${tab.id}`}
                className={`rounded-xl px-3 py-3 text-left transition ${
                  selected
                    ? "bg-brand text-white shadow-sm"
                    : "border border-white/10 text-ink-muted hover:border-brand-light/40 hover:bg-white/5 hover:text-white"
                }`}
                aria-current={selected ? "page" : undefined}
              >
                <span className="block text-center text-sm font-semibold">
                  {tab.label}
                </span>
              </Link>
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
