import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeCalendarTodayUi, calendarTodayUiPaths } from './helpers/calendar-today-ui-boundary.mjs';

test('Today and visible-date navigation preserve the released calendar UI outside their exact hunks', () => {
  for (const file of calendarTodayUiPaths) {
    assert.equal(beforeCalendarTodayUi(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')),
      execFileSync('git', ['show', `961e8af6c87d09b7145f3ad1e4dd6c818b023082:booking/${file}`], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
      }), file);
  }
});
