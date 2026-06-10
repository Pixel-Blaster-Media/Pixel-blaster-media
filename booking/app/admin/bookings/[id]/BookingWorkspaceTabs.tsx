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
      <div className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-2">
        <div className="flex gap-2 overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-x-visible lg:grid-cols-5">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <Link
                key={tab.id}
                href={tab.id === "media" ? baseHref : `${baseHref}?tab=${tab.id}`}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-3 text-left transition sm:shrink sm:whitespace-normal ${
                  selected
                    ? "bg-realtor-primary text-white shadow-sm"
                    : "border border-realtor-primary/15 text-realtor-muted hover:border-realtor-primary/40 hover:bg-realtor-primary/5 hover:text-realtor-primary"
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
