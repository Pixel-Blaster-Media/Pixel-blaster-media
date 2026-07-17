import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  publicVapidKey,
  pushNotificationsConfigured,
} from "@/lib/notifications/push";
import {
  loadTodayCommandPreferences,
  saveTodayCommandPreferences,
} from "../../today/actions";
import type { TodayCommandPreferences } from "../../today/preferences";
import InstallAppCard from "../InstallAppCard";

export const metadata = { title: "Workspace & app" };

export default async function WorkspacePreferencesPage() {
  const admin = await requireAdmin();
  const preferences = await loadTodayCommandPreferences(admin.organizationId);

  return (
    <div className="space-y-6 pb-10">
      <header className="max-w-3xl">
        <Link
          href="/admin/settings"
          className="text-sm font-semibold text-realtor-primary hover:text-realtor-text"
        >
          ← Settings
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-realtor-text">
          Workspace & app
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Install the app on this device and choose what your company sees on
          the Today screen during a shoot day.
        </p>
      </header>

      <InstallAppCard
        publicKey={publicVapidKey()}
        configured={pushNotificationsConfigured()}
      />
      <TodayPreferencesCard preferences={preferences} />
    </div>
  );
}

function TodayPreferencesCard({
  preferences,
}: {
  preferences: TodayCommandPreferences;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-realtor-primary/12 bg-realtor-surface/80">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary/75">
            Company Today view
          </p>
          <h2 className="mt-1 text-xl font-semibold text-realtor-text">
            What should appear each morning?
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-realtor-muted">
            These choices apply to every admin in this company. Turn off
            sections that create noise.
          </p>
        </div>
        <Link
          href="/admin/today"
          className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Open Today
        </Link>
      </div>

      <form action={saveTodayCommandPreferences} className="border-t border-realtor-primary/10">
        <div className="divide-y divide-realtor-primary/10">
          <TodayPreferenceToggle
            name="show_deliverables"
            label="Delivery reminders"
            description="Unfinished media links and delivery checklist items."
            checked={preferences.showDeliverables}
          />
          <TodayPreferenceToggle
            name="show_agent_memory"
            label="Agent memory"
            description="Saved realtor preferences and private reminder notes."
            checked={preferences.showAgentMemory}
          />
          <TodayPreferenceToggle
            name="show_route_warnings"
            label="Route spacing"
            description="Tight gaps, city changes, and map links between shoots."
            checked={preferences.showRouteWarnings}
          />
          <TodayPreferenceToggle
            name="show_booking_notes"
            label="Booking notes"
            description="Client notes and private notes on each shoot."
            checked={preferences.showBookingNotes}
          />
          <TodayPreferenceToggle
            name="show_shoot_brief"
            label="AI shoot brief"
            description="The AI-generated shoot-day planning panel."
            checked={preferences.showShootBrief}
          />
        </div>
        <div className="flex justify-end bg-white/40 px-4 py-4 sm:px-5">
          <button
            type="submit"
            className="w-full rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 sm:w-auto"
          >
            Save preferences
          </button>
        </div>
      </form>
    </section>
  );
}

function TodayPreferenceToggle({
  name,
  label,
  description,
  checked,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
}) {
  return (
    <label className="flex min-h-20 cursor-pointer items-start gap-3 bg-white/45 px-4 py-4 transition hover:bg-white/85 sm:px-5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="mt-1 h-5 w-5 shrink-0 accent-realtor-primary"
      />
      <span>
        <span className="block text-sm font-semibold text-realtor-text">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-realtor-muted sm:text-sm">
          {description}
        </span>
      </span>
    </label>
  );
}
