import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reverse only the Today control wiring, preserving the previous UI snapshots.
// Actual scrolling and Toronto date behavior are exercised in the browser suite.
const delta = JSON.parse(readFileSync(new URL('./calendar-today-ui-delta.json', import.meta.url), 'utf8'));
export const calendarTodayUiPaths = Object.keys(delta);
export function beforeCalendarTodayUi(path, source) {
  for (const [candidate, prior] of delta[path] ?? []) {
    assert.equal(source.split(candidate).length - 1, 1, 'exact calendar Today hunk: ' + path);
    source = source.replace(candidate, () => prior);
  }
  return source;
}
