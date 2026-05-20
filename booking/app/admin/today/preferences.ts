export interface TodayCommandPreferences {
  showDeliverables: boolean;
  showAgentMemory: boolean;
  showRouteWarnings: boolean;
  showBookingNotes: boolean;
  showShootBrief: boolean;
}

export const DEFAULT_TODAY_COMMAND_PREFERENCES: TodayCommandPreferences = {
  showDeliverables: true,
  showAgentMemory: true,
  showRouteWarnings: true,
  showBookingNotes: true,
  showShootBrief: true,
};
