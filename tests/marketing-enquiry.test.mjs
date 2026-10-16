import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const source = fs.readFileSync(path.join(__dirname, '../enquiry.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('corporate and brand enquiries have a selectable project type', () => {
  const select = html.match(/<select name="type"[^>]*>([\s\S]*?)<\/select>/)[1];
  const options = [...select.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
  assert.ok(options.includes('Corporate &amp; brand'));
  assert.equal(options.length, 6, 'placeholder plus five supported project types');
});

class Element {
  constructor() { this.events = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.attributes = {}; this.focusCount = 0; }
  addEventListener(event, fn) { (this.events[event] ||= []).push(fn); }
  async fire(event) { for (const fn of this.events[event] || []) await fn({ preventDefault() {} }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focusCount++; }
  showModal() { this.open = true; }
}

function setup(request) {
  const nodes = new Map();
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  for (const id of html.matchAll(/\bid="([^"]+)"/g)) get(`#${id[1]}`);
  for (const id of ['#enquiry-review', '#enquiry-fallback', '#new-enquiry', '#listing-booking']) get(id).hidden = true;
  const form = get('#enquiry-form');
  const fields = ['name', 'email', 'company', 'type', 'details', 'timing'].map(name => Object.assign(new Element(), {name, value: ''}));
  fields.namedItem = name => fields.find(field => field.name === name);
  form.elements = fields;
  form.action = html.match(/<form action="([^"]+)"[^>]*id="enquiry-form"/)[1];
  form.reportValidity = () => ['name', 'email', 'type', 'details'].every(name => !!fields.namedItem(name).value) && /.+@.+\..+/.test(fields.namedItem('email').value);
  form.reset = () => fields.forEach(field => {field.value = '';});
  get('#route-dialog').querySelector = get;
  get('#route-dialog').open = true;
  const enquiry = Object.assign(new Element(), {dataset: {route: 'enquiry'}});
  const booking = Object.assign(new Element(), {dataset: {route: 'booking'}});
  const requests = [], timers = new Map();
  let timerId = 0;
  class MockFormData extends Map {
    constructor(from) { super(from ? from.elements.filter(x => x.name).map(x => [x.name, x.value]) : []); }
    append(k, v) { this.set(k, v); }
  }
  vm.runInNewContext(source, {
    document: {querySelector: get, querySelectorAll: () => [enquiry, booking]},
    FormData: MockFormData, AbortController,
    fetch: (...args) => { requests.push(args); return request(...args); },
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    navigator: {clipboard: {writeText: async () => {}}},
  });
  function fill(values = {}) {
    const defaults = {name: 'QA Example', email: 'qa@example.invalid', company: 'Example', type: 'Products', details: 'Local mock only', timing: 'Next month', ...values};
    fields.forEach(field => {field.value = defaults[field.name];});
  }
  return {get, form, fields, requests, timers, enquiry, booking, fill, review: () => form.fire('submit'), send: () => get('#send-enquiry').fire('click')};
}

test('invalid or whitespace-only required fields never send', async () => {
  const app = setup(() => { throw Error('Must not request'); });
  app.fill({name: '   '}); await app.review(); await app.send();
  assert.equal(app.requests.length, 0);
  assert.equal(app.get('#enquiry-review').hidden, true);
});

test('review has no request; double clicks send one compatible payload', async () => {
  let resolve;
  const app = setup(() => new Promise(done => {resolve = done;}));
  app.fill({name: '  QA Example  '}); await app.review();
  assert.equal(app.requests.length, 0);
  const pending = app.send(); await app.send();
  assert.equal(app.requests.length, 1);
  const [endpoint, options] = app.requests[0];
  assert.equal(endpoint, 'https://formspree.io/f/meerqpoj');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(Object.fromEntries(options.body), {name:'QA Example', email:'qa@example.invalid', service:'Products', message:'Local mock only', company:'Example', timing:'Next month'});
  assert.equal(app.get('#send-enquiry').disabled, true);
  assert.equal(app.get('#edit-brief').disabled, true);
  assert.match(app.get('#enquiry-status').textContent, /Sending/);
  resolve({ok:true}); await pending;
  assert.equal(app.get('#enquiry-status').dataset.state, 'success');
  assert.equal(app.get('#send-enquiry').hidden, true);
  await app.enquiry.fire('click'); await app.send(); await app.review(); await app.send();
  assert.equal(app.requests.length, 1, 'success remains protected after reopening');
  assert.equal(app.timers.size, 0);
});

test('validation failure preserves data and supports editing before a manual retry', async () => {
  let attempt = 0;
  const app = setup(async () => ++attempt === 1 ? {ok:false, status:422, json:async () => ({errors:[{message:'Please check email.'}]})} : {ok:true});
  app.fill(); await app.review(); await app.send();
  assert.equal(app.form.elements.namedItem('details').value, 'Local mock only');
  assert.match(app.get('#enquiry-status').textContent, /Please check email/);
  assert.equal(app.get('#enquiry-fallback').hidden, false);
  await app.get('#edit-brief').fire('click');
  app.form.elements.namedItem('details').value = 'Revised brief';
  await app.review(); await app.send();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1][1].body.get('message'), 'Revised brief');
});

test('network failures and server errors never claim success or automatically retry', async () => {
  for (const request of [async () => {throw Error('Offline');}, async () => ({ok:false,status:503})]) {
    const app = setup(request); app.fill(); await app.review(); await app.send();
    assert.equal(app.requests.length, 1);
    assert.equal(app.get('#enquiry-status').dataset.state, 'error');
    assert.match(app.get('#enquiry-status').textContent, /may have reached Mike/);
    assert.equal(app.form.elements.namedItem('email').value, 'qa@example.invalid');
    assert.equal(app.get('#send-enquiry').disabled, false);
  }
});

test('timeout retains draft and warns delivery is uncertain', async () => {
  const app = setup((url, {signal}) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')))));
  app.fill(); await app.review(); const pending = app.send();
  [...app.timers.values()][0](); await pending;
  assert.match(app.get('#enquiry-status').textContent, /couldn’t confirm/);
  assert.equal(app.requests.length, 1);
  assert.equal(app.timers.size, 0);
  assert.equal(app.form.elements.namedItem('name').value, 'QA Example');
});

test('rate limits and non-JSON errors retain the brief', async () => {
  for (const status of [429, 400, 403]) {
    const app = setup(async () => ({ok:false,status,json:async () => {throw Error('Not JSON');}}));
    app.fill(); await app.review(); const before = app.get('#brief-text').textContent; await app.send();
    assert.equal(app.get('#brief-text').textContent, before);
    assert.equal(app.get('#enquiry-status').dataset.state, 'error');
    if (status === 429) assert.match(app.get('#enquiry-status').textContent, /wait/);
  }
});

test('closing or switching to booking does not clear a pending request or steal focus', async () => {
  let resolve;
  const app = setup(() => new Promise(done => {resolve = done;}));
  app.fill(); await app.review(); const before = app.get('#review-title').focusCount;
  const pending = app.send(); app.get('#route-dialog').open = false;
  await app.booking.fire('click'); resolve({ok:true}); await pending;
  assert.equal(app.get('#review-title').focusCount, before);
  assert.equal(app.form.elements.namedItem('details').value, 'Local mock only');
  await app.enquiry.fire('click'); await app.send();
  assert.equal(app.requests.length, 1);
});

test('only an explicit new-enquiry action resets a successful draft', async () => {
  const app = setup(async () => ({ok:true})); app.fill(); await app.review(); await app.send();
  await app.get('#new-enquiry').fire('click');
  assert.equal(app.form.elements.namedItem('name').value, '');
  assert.equal(app.form.hidden, false);
  assert.equal(app.get('#enquiry-review').hidden, true);
  assert.equal(app.get('#enquiry-status').textContent, '');
});
