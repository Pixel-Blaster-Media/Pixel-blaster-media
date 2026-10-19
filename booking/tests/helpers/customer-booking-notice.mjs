import { loadSource, resultQuery } from './source-module.mjs';

export const policy = loadSource('lib/booking/notice-policy.ts');

export function noticeHarness({ now = '2026-10-19T14:00:00Z', enabled = true, failure = false } = {}) {
  let clock = new Date(now).getTime();
  const calls = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const state = { enabled, failure };
  const db = { from(table) {
    calls.push(['from', table]);
    return resultQuery({
      data: table === 'organizations' ? { require_24_hour_notice: state.enabled }
        : table === 'business_hours' ? Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, start_time: '09:00:00', end_time: '17:00:00', enabled: true })) : [],
      error: state.failure && table === 'organizations' ? { code: 'offline' } : null,
    }, calls);
  } };
  const settings = loadSource('lib/booking/notice-settings.ts', {
    '@/lib/supabase/server': { getServiceSupabase: () => db }, './notice-policy': policy,
  }, { Date: Clock });
  const availability = loadSource('lib/booking/availability.ts', {
    './notice-settings': settings, './notice-policy': policy,
    '@/lib/supabase/server': { getServiceSupabase: () => db },
    '@/lib/organizations/default': { DEFAULT_ORGANIZATION_ID: 'org-a' },
    '@/lib/integrations/google-calendar/client': { getGoogleCalendarClients: async () => { state.onCalendarRead?.(); return []; } },
    '@/lib/booking/timezone': { BUSINESS_TZ: 'America/Toronto' },
    './services': { totalDurationMinutes: () => 60 },
  }, { Date: Clock });
  return { state, calls, settings, availability, advance(ms) { clock += ms; } };
}
