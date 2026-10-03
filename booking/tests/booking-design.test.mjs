import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource } from './helpers/source-module.mjs';

const quote = loadSource('lib/booking/quote.ts');
const wizard = loadSource('lib/booking/wizard-state.ts');
const groups = loadSource('lib/booking/catalog-sample-groups.ts');
const description = loadSource('app/book/_components/package-description.ts');
const Total = loadSource('app/book/_components/BookingTotalBar.tsx', {
  '@/lib/booking/quote': quote, 'react/jsx-runtime': jsxRuntime, react: React,
}).default;
const item = (extra = {}) => ({
  id: 'bundle', slug: 'bundle', name: 'Test package', kind: 'bundle', description: '',
  duration_minutes: 120, price_cents: 60000, sqft_pricing_enabled: false,
  is_photo: true, is_video: true, is_iguide: true, is_aerial: false,
  video_overage_threshold_sqft: 2500, video_overage_price_cents: 5000,
  examples: [], ...extra,
});
const sample = (extra = {}) => ({
  id: 'video', title: 'Film example', kind: 'video', sample_group_key: null,
  sample_group_label: null, external_url: null,
  embed_url: 'https://player.example.invalid/existing-video', ...extra,
});
const Picker = loadSource('app/book/_components/PackageAccordion.tsx', {
  react: React, 'react/jsx-runtime': jsxRuntime,
  'next/navigation': {useRouter: () => ({replace() { throw Error('render must not change selection'); }}), useSearchParams: () => new URLSearchParams('services=bundle')},
  '@/lib/booking/quote': quote, '@/lib/booking/wizard-state': wizard,
  '@/lib/booking/catalog-sample-groups': groups,
  '@/lib/booking/catalog-rules': {isAddonEligible: () => true},
  './BookingTotalBar': {default: Total}, './package-description': description,
}).default;
const render = (bundles, extra = {}) => renderToStaticMarkup(React.createElement(Picker, {
  bundles, aLaCarte: [], addons: [], selectedSlugs: ['bundle'], selectedAddOnSlugs: [], squareFootage: null, ...extra,
}));

test('details keep every catalog inclusion, including lines beyond the former eight-line limit', () => {
  const lines = Array.from({length: 12}, (_, i) => `Inclusion ${i + 1}`);
  const html = render([item({description: lines.join('\n')})]);
  for (const line of lines) assert.ok(html.includes(`<span>${line}</span>`), line);
  assert.match(html, /<details class="booking-refresh-details">[\s\S]*<details class="booking-refresh-examples">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:\s|=|>)/);
  assert.doesNotMatch(html, /<article[^>]*tabindex|<iframe|<img/);
});

test('each existing sample opens unchanged in a separate tab with descriptive accessible text', () => {
  const html = render([item({examples: [sample(), sample({id:'tour',title:'Tour example',kind:'interactive',embed_url:null,external_url:'https://example.invalid/tour?view=2'})]})]);
  assert.match(html, /href="https:\/\/player.example.invalid\/existing-video" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Film example — Video for Test package \(opens in a new tab\)/);
  assert.match(html, /Tour example — iGUIDE for Test package \(opens in a new tab\)/);
  assert.match(html, /Watch sample/);
  assert.match(html, /Explore iGUIDE/);
  assert.match(html, /aria-hidden="true">▶/);
  assert.doesNotMatch(html, /<iframe|<dialog/);
});

test('missing and unsafe sample destinations never become invented or active links', () => {
  const html = render([item({examples: [
    sample({id:'js',external_url:'javascript:alert(1)'}),
    sample({id:'data',external_url:'data:text/html,test'}),
    sample({id:'http',external_url:'http://example.invalid/'}),
    sample({id:'credentials',external_url:'https://user:password@example.invalid/'}),
    sample({id:'broken',external_url:'not a URL'}),
  ]})]);
  assert.match(html, /No example yet/);
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 0);
  assert.doesNotMatch(html, /javascript:|data:text|user:password|href="#"/);
});

test('multiple samples retain individual titles and custom service groups', () => {
  const html = render([item({examples: [sample(),sample({id:'second',title:'Second film'}),sample({id:'details',title:'Detail photos example',kind:'link',sample_group_key:'custom_details',sample_group_label:'Detail photos',external_url:'https://example.invalid/details'})]})]);
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 3);
  assert.match(html, />Film example<\/span>/);
  assert.match(html, />Second film<\/span>/);
  assert.match(html, /Detail photos/);
});

test('selection footer waits for a service and uses the shared multiselect quote and once-only basement time', () => {
  const props = {items:[item(),item({id:'video',slug:'video',name:'Video',duration_minutes:60,price_cents:32500})],selectedSlugs:[],selectedAddOnSlugs:[],squareFootage:2501,includeBasement:true,href:'/book/property?services=bundle,video',selectionSummary:true};
  const empty = renderToStaticMarkup(React.createElement(Total,props));
  assert.match(empty, /Choose your services/);
  assert.match(empty, /<button[^>]*disabled/);
  assert.doesNotMatch(empty, /<a /);
  const selected = renderToStaticMarkup(React.createElement(Total,{...props,selectedSlugs:['bundle','video','bundle']}));
  assert.match(selected, /\$1025/);
  assert.match(selected, /3h 15min/);
  assert.equal((selected.match(/Includes 15 minutes for the finished basement/g)??[]).length,1);
  assert.match(selected, /aria-live="polite" aria-atomic="true"/);
  assert.match(selected, /Test package \+\$50, Video \+\$50/);
  assert.match(selected, /href="\/book\/property\?services=bundle,video"/);
});

function visibleActionNames(markup) {
  return [...markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map((match) => ({
      visible: match[3].replace(/<([a-z]+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim(),
      name: match[2].match(/aria-label="([^"]+)"/)?.[1],
    })).filter((control) => control.name);
}

test('selected and unselected package/service/add-on names preserve the entire visible action', () => {
  for (const selected of [false, true]) {
    const html = render([item()], {
      selectedSlugs: selected ? ['bundle','service'] : [],
      selectedAddOnSlugs: selected ? ['addon'] : [],
      aLaCarte:[item({id:'service',slug:'service',name:'Individual service',kind:'a_la_carte'})],
      addons:[item({id:'addon',slug:'addon',name:'Extra service',kind:'addon'})],
    });
    const names = visibleActionNames(html);
    assert.equal(names.length,3);
    for (const control of names) assert.ok(control.name.startsWith(control.visible), JSON.stringify(control));
    assert.ok(names.some(control => control.visible === (selected ? 'Added' : 'Add service')));
    assert.ok(names.some(control => control.visible === (selected ? 'Added' : 'Add to booking')));
    if (selected) assert.ok(names.some(control => /remove service/.test(control.name)));
  }
});

test('single and multiple video, link and tour example names start with their visible labels', () => {
  for (const examples of [
    [sample()],
    [sample({kind:'interactive',external_url:'https://example.invalid/tour'})],
    [sample({kind:'link',external_url:'https://example.invalid/photos',sample_group_key:'photos',sample_group_label:'Photos'})],
    [sample(),sample({id:'second',title:'Second film'})],
  ]) {
    const names = visibleActionNames(render([item({examples})]));
    for (const control of names) assert.ok(control.name.startsWith(control.visible), JSON.stringify(control));
  }
});
