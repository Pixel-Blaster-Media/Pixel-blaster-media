import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource } from './helpers/source-module.mjs';

const quote = loadSource('lib/booking/quote.ts');
const wizard = loadSource('lib/booking/wizard-state.ts');
const item = (overrides = {}) => ({
  id: 'special', slug: 'social_media_special', name: 'Social Media Special', kind: 'bundle',
  price_cents: 60000, duration_minutes: 120, is_video: true,
  sqft_pricing_enabled: true, included_sqft: 2500, overage_increment_sqft: 500, overage_price_cents: 4000,
  video_overage_threshold_sqft: 2500, video_overage_price_cents: 5000, ...overrides,
});

test('video fee boundary is strictly above 2,500; measuring remains independent', () => {
  for (const [sqft, measuring, video, total] of [
    [null, 0, 0, 60000], [2500, 0, 0, 60000], [2501, 4000, 5000, 69000],
    [3000, 4000, 5000, 69000], [3001, 8000, 5000, 73000], [10000, 60000, 5000, 125000],
  ]) {
    const actual = quote.getCatalogItemPrice(item(), sqft);
    assert.equal(actual.measurementOverageCents, measuring);
    assert.equal(actual.videoOverageCents, video);
    assert.equal(actual.totalPriceCents, total);
  }
});

test('Ultimate incurs one flat video fee, not one fee for each bundled video', () => {
  const actual = quote.getCatalogItemPrice(item({ slug: 'ultimate', price_cents: 95000, duration_minutes: 240 }), 2501);
  assert.equal(actual.totalPriceCents, 104000);
  assert.equal(actual.videoOverageCents, 5000);
});

test('standalone Video Tour uses the same boundary without measuring fees', () => {
  const video = item({ slug: 'video_tour', price_cents: 32500, sqft_pricing_enabled: false });
  assert.equal(quote.getCatalogItemPrice(video, 2500).totalPriceCents, 32500);
  assert.equal(quote.getCatalogItemPrice(video, 2501).totalPriceCents, 37500);
});

test('unconfigured reels, aerial add-ons and other tenant catalog rows gain no video fee', () => {
  for (const slug of ['social_media_reel', 'aerial', 'on_camera', 'social_media_special']) {
    const actual = quote.getCatalogItemPrice(item({ slug, sqft_pricing_enabled: false, video_overage_threshold_sqft: null, video_overage_price_cents: 0 }), 5000);
    assert.equal(actual.totalPriceCents, 60000);
  }
});

test('basement adds 15 minutes once after the existing minimum; zero fee impact', () => {
  for (const [base, withBasement, without] of [[30,75,60],[60,75,60],[120,135,120],[200,215,200]]) {
    assert.equal(quote.bookingDurationMinutes(base,true),withBasement);
    assert.equal(quote.bookingDurationMinutes(base,false),without);
    assert.equal(quote.bookingDurationMinutes(base,null),without);
  }
});

test('server multiselect totals include independent line fees and basement only once', () => {
  const { computeCartTotals } = loadSource('lib/booking/catalog.ts', {
    '@/lib/booking/quote': quote,
    '@/lib/organizations/default': {}, '@/lib/supabase/server': {}, '@/lib/booking/catalog-rules': {},
  });
  const catalog = { bundles: [item()], aLaCarte: [item({ id:'video',kind:'a_la_carte',slug:'video_tour',price_cents:32500,duration_minutes:60,sqft_pricing_enabled:false })], addons: [item({ id:'aerial',kind:'addon',slug:'aerial',price_cents:10000,duration_minutes:20,sqft_pricing_enabled:false,video_overage_price_cents:0 })] };
  const cart = ['special','video','aerial'].map(catalogItemId=>({catalogItemId,quantity:1}));
  const actual = computeCartTotals(cart,catalog,2501,true);
  assert.equal(actual.totalPriceCents,116500);
  assert.equal(actual.totalDurationMinutes,215);
  assert.equal(computeCartTotals(cart,catalog,2500,false).totalPriceCents,102500);
});

test('actual running-total component shows the agreed fee and once-only basement time', () => {
  const Total = loadSource('app/book/_components/BookingTotalBar.tsx', {
    '@/lib/booking/quote': quote, 'react/jsx-runtime': jsxRuntime, react: React,
  }).default;
  const markup = renderToStaticMarkup(React.createElement(Total, { items:[item()], selectedSlugs:['social_media_special','social_media_special'], selectedAddOnSlugs:[], squareFootage:2501, includeBasement:true }));
  assert.match(markup, /\$690/);
  assert.match(markup, /2h 15min/);
  assert.match(markup, /Includes 15 minutes for the finished basement/);
  assert.match(markup, /Social Media Special \+\$90/);
});

test('new SQL applies the policy only to new snapshots and preserves historical/replay boundaries', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930203055_booking_size_and_basement_policy.sql', import.meta.url), 'utf8');
  assert.match(sql, /organization_id = '00000000-0000-0000-0000-000000000001'/);
  assert.match(sql, /slug in \('social_media_special', 'social_media_plus', 'ultimate', 'video_tour'\)/);
  assert.doesNotMatch(sql, /update public\.booking_line_items|update public\.bookings\s+set basement_duration_minutes/);
  assert.match(sql, /v_basement_minutes := v_old\.basement_duration_minutes/);
  assert.match(sql, /v_start\+\(v_old\.scheduled_ends_at-v_old\.scheduled_at\)/);
  assert.equal((sql.match(/public\.catalog_booking_price_cents\((catalog, p_square_footage|c,v_sqft)\)/g) ?? []).length, 2);
  assert.match(sql, /revoke all on function public\.catalog_booking_price_cents\(public\.catalog_items,integer\) from public,anon,authenticated/);
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

test('changing a package keeps the private draft but invalidates the old time slot', () => {
  let destination;
  const draft = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const Picker = loadSource('app/book/_components/PackageAccordion.tsx', {
    'react/jsx-runtime': jsxRuntime,
    react: { useMemo: fn=>fn(), useState: initial=>[initial===null?null:true,()=>{}], useEffect:()=>{}, useRef:()=>({current:null}) },
    'next/navigation': {useRouter:()=>({replace:url=>{destination=url;}}),useSearchParams:()=>new URLSearchParams(`services=social_media_special&draft=${draft}&slot=2090-01-01T15:00:00Z&shoot_notes=private`)},
    '@/lib/booking/quote': quote, '@/lib/booking/wizard-state': wizard,
    '@/lib/booking/catalog-sample-groups': {getCatalogSampleGroups:()=>[]},
    '@/lib/booking/catalog-sample-viewer': loadSource('lib/booking/catalog-sample-viewer.ts'),
    '@/lib/booking/catalog-rules': {isAddonEligible:()=>true},
    './BookingTotalBar': {default:()=>null},
    './package-description': {findCommonPackageLines:()=>[],packageDescriptionLines:()=>[],withoutCommonPackageLines:()=>[]},
  }).default;
  const tree = Picker({bundles:[item({description:''})],aLaCarte:[item({slug:'video_tour',name:'Video Tour',kind:'a_la_carte',description:''})],addons:[],selectedSlugs:['social_media_special'],selectedAddOnSlugs:[],squareFootage:2501,includeBasement:true});
  nodes(tree).find(node=>node.props?.['aria-label']==='Add service: Video Tour').props.onClick({stopPropagation(){}});
  const query = new URLSearchParams(destination.slice(1));
  assert.equal(query.get('draft'),draft);
  assert.equal(query.get('services'),'social_media_special,video_tour');
  assert.equal(query.has('slot'),false);
  assert.equal(query.has('shoot_notes'),false);
});

test('confirmation upsell returns to availability without losing the private draft', () => {
  let destination;
  const draft = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const params = new URLSearchParams(`services=video_tour&draft=${draft}&slot=2090-01-01T15:00:00Z`);
  const Upsell = loadSource('app/book/confirm/ConfirmUpsellPanel.tsx', {
    'react/jsx-runtime': jsxRuntime, '@/lib/booking/quote':quote, '@/lib/booking/wizard-state':wizard,
    'next/navigation':{useRouter:()=>({replace:url=>{destination=url;}}),useSearchParams:()=>params},
    '@/lib/booking/catalog-eligibility':{getSelectedServiceCapabilities:()=>({}),isCatalogAddonEligible:()=>true},
  }).default;
  const tree=Upsell({state:wizard.parseWizardState(Object.fromEntries(params)),catalog:[item({slug:'video_tour',kind:'a_la_carte'}),item({slug:'residential_photography',kind:'a_la_carte'})]});
  nodes(tree).find(node=>node.type==='button').props.onClick();
  const url=new URL(destination,'https://example.invalid');
  assert.equal(url.pathname,'/book/schedule');
  assert.equal(url.searchParams.get('draft'),draft);
  assert.equal(url.searchParams.has('slot'),false);
  assert.equal(url.searchParams.get('services'),'video_tour,residential_photography');
});
