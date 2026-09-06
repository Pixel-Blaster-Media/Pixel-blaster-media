import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import CalendarModule from '../app/book/schedule/CalendarPicker.tsx';
const CalendarPicker = CalendarModule.default ?? CalendarModule;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const daysOfSlots = [
 {dateKey:'2026-09-30',dateLabel:'Wednesday, Sep 30',slots:[{start:'2026-09-30T13:00:00Z',timeLabel:'9:00 AM'}]},
 {dateKey:'2026-10-01',dateLabel:'Thursday, Oct 1',slots:[{start:'2026-10-01T14:00:00Z',timeLabel:'10:00 AM'}]},
];
async function mount(selectedSlot=null) {
 const pushed=[]; let renderer;
 await act(async()=> {renderer=TestRenderer.create(React.createElement(AppRouterContext.Provider,{value:{push:url=>pushed.push(url)}},React.createElement(SearchParamsContext.Provider,{value:new URLSearchParams('service=photo')},React.createElement(CalendarPicker,{daysOfSlots,selectedSlot}))));});
 return {renderer,pushed};
}
function button(r,label) { const b=r.root.findAllByType('button').find(b=>b.props['aria-label']===label);assert.ok(b,`missing accessible button: ${label}`);return b; }
test('calendar exposes full date, available/unavailable state and updates pressed day on activation',async()=>{
 const {renderer:r}=await mount();
 try {
 const available=button(r,'Wednesday, September 30, 2026 — 1 available time');
 assert.equal(available.props.disabled,false);assert.equal(available.props['aria-pressed'],false);
 assert.equal(button(r,'Tuesday, September 29, 2026 — No available times').props.disabled,true);
 await act(async()=>available.props.onClick());
 assert.equal(button(r,'Wednesday, September 30, 2026 — 1 available time').props['aria-pressed'],true);
 assert.match(JSON.stringify(r.toJSON()),/America\/Toronto/);
 await act(async()=>button(r,'Next month').props.onClick());
 await act(async()=>button(r,'Thursday, October 1, 2026 — 1 available time').props.onClick());
 assert.equal(button(r,'Thursday, October 1, 2026 — 1 available time').props['aria-pressed'],true);
 assert.equal(button(r,'Wednesday, September 30, 2026 — 1 available time').props['aria-pressed'],false);
 } finally {await act(async()=>r.unmount());}
});
test('revisited selected slot exposes full date, time, timezone and pressed state; navigation preserves query',async()=>{
 const {renderer:r,pushed}=await mount('2026-09-30T13:00:00Z');
 try {
 assert.equal(button(r,'Wednesday, September 30, 2026 — 1 available time').props['aria-pressed'],true);
 const slot=button(r,'Wednesday, September 30, 2026 at 9:00 AM (America/Toronto)');
 assert.equal(slot.props['aria-pressed'],true);
 await act(async()=>slot.props.onClick());
 const url=new URL(pushed[0],'https://fixture.invalid');assert.equal(url.pathname,'/book/confirm');assert.equal(url.searchParams.get('service'),'photo');assert.equal(url.searchParams.get('slot'),'2026-09-30T13:00:00Z');
 } finally {await act(async()=>r.unmount());}
});
