import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../marketing.js', import.meta.url), 'utf8');
const portfolio = JSON.parse(fs.readFileSync(new URL('../portfolio.js', import.meta.url), 'utf8').split('=').slice(1).join('=').trim().replace(/;$/, ''));
const slugs = ['brand-product', 'portraits-people', 'interiors-architecture', 'commercial-lifestyle', 'food-hospitality', 'real-estate-aerial'];

// Browser primitives only: run the actual page script and exercise its public UI events.
function fixture(initial = 'https://example.test/?campaign=gallery#work') {
  const pending = [];
  let focused;
  class Element {
    constructor() { this.events = {}; this.children = []; this.dataset = {}; this.attributes = {}; this.open = false; this.hidden = false; this.classList = { toggle() {}, remove() {} }; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    emit(type, event = {}) { for (const fn of this.events[type] || []) fn({ target: this, ...event }); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    showModal() { this.open = true; }
    close() { this.open = false; pending.push(() => this.emit('close')); }
    focus() { focused = this; }
    scrollIntoView() { this.scrolled = true; }
    closest() { return { hidden: false }; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const elements = Object.fromEntries(['.menu-toggle', '#navigation', '.portfolio-grid', '#collection-dialog', '#collection-title', '#collection-description', '#collection-images', '#collection-jumps', '#open-reel', '#reel-dialog', '#work'].map(s => [s, new Element()]));
  const buttons = Object.fromEntries(Object.keys(portfolio.collections).map(key => { const b = new Element(); b.dataset.collection = key; elements[`[data-collection="${key}"]`] = b; return [key, b]; }));
  const window = new Element();
  const location = new URL(initial);
  const entries = [{ url: initial, state: null }]; let at = 0;
  const history = {
    get state() { return entries[at].state; },
    get length() { return entries.length; },
    pushState(state, _, url) { entries.splice(at + 1); entries.push({ state, url: String(url) }); at++; location.href = String(url); },
    replaceState(state, _, url) { entries[at] = { state, url: String(url) }; location.href = String(url); },
    back() { if (at > 0) { at--; location.href = entries[at].url; window.emit('popstate'); window.emit('hashchange'); } },
    forward() { if (at < entries.length - 1) { at++; location.href = entries[at].url; window.emit('popstate'); window.emit('hashchange'); } },
  };
  const document = { querySelector: s => elements[s], querySelectorAll: s => s === '[data-collection]' ? Object.values(buttons) : s === 'dialog' ? [elements['#collection-dialog'], elements['#reel-dialog']] : [], createElement: () => new Element() };
  vm.runInNewContext(source, { document, window, location, history, URL, portfolio });
  return { elements, buttons, location, history, window, dialog: elements['#collection-dialog'], flush() { while (pending.length) pending.shift()(); }, get focused() { return focused; } };
}

for (const [index, [key, item]] of Object.entries(portfolio.collections).entries()) {
  test(`${key}: direct link, refresh, images and close preserve the query`, () => {
    assert.equal(item.slug, slugs[index]);
    for (let refresh = 0; refresh < 2; refresh++) {
      const f = fixture(`https://example.test/?campaign=gallery#gallery/${item.slug}`);
      assert.equal(f.dialog.open, true);
      assert.equal(f.elements['#collection-title'].textContent, item.title);
      assert.equal(f.elements['#collection-images'].children.flatMap(s => s.children[2].children).length, item.photos.length);
      f.dialog.close(); f.flush();
      assert.equal(f.location.hash, '#work');
      assert.equal(f.location.search, '?campaign=gallery');
      assert.equal(f.history.length, 1);
      assert.equal(f.focused, f.buttons[key]);
    }
  });
}

test('card open, close, Back and Forward follow the gallery URL', () => {
  const f = fixture();
  f.buttons.spaces.emit('click');
  assert.equal(f.location.hash, '#gallery/interiors-architecture');
  assert.equal(f.history.length, 2);
  f.history.back(); f.flush();
  assert.equal(f.dialog.open, false);
  assert.equal(f.location.hash, '#work');
  f.history.forward();
  assert.equal(f.dialog.open, true);
  f.dialog.close(); f.flush();
  assert.equal(f.location.hash, '#work');
  f.history.forward();
  assert.equal(f.dialog.open, true);
});

test('hash navigation switches collection without reopening or duplicate history', () => {
  const f = fixture(); f.buttons.brand.emit('click');
  const length = f.history.length;
  f.window.emit('popstate'); f.window.emit('hashchange');
  assert.equal(f.history.length, length);
  f.location.hash = '#gallery/real-estate-aerial'; f.window.emit('hashchange');
  assert.equal(f.elements['#collection-title'].textContent, portfolio.collections.property.title);
  f.location.hash = '#about'; f.window.emit('hashchange'); f.flush();
  assert.equal(f.dialog.open, false);
  assert.equal(f.location.hash, '#about');
});

test('invalid gallery links fall back safely and other anchors are untouched', () => {
  for (const hash of ['#gallery/missing', '#gallery/', '#gallery/%E0%A4%A', '#gallery/__proto__']) {
    const f = fixture(`https://example.test/?keep=yes${hash}`);
    assert.equal(f.dialog.open, false);
    assert.equal(f.location.hash, '#work');
    assert.equal(f.location.search, '?keep=yes');
  }
  for (const hash of ['', '#about', '#services', '#enquire']) {
    const f = fixture(`https://example.test/${hash}`);
    assert.equal(f.location.hash, hash);
    assert.equal(f.dialog.open, false);
  }
});

test('a queued close event does not close a gallery reopened by Forward', () => {
  const f = fixture(); f.buttons.spaces.emit('click');
  f.history.back(); f.history.forward(); f.flush();
  assert.equal(f.dialog.open, true);
  assert.equal(f.location.hash, '#gallery/interiors-architecture');
});

test('all collection photos have unique entries and local responsive assets', () => {
  assert.equal(new Set(Object.values(portfolio.collections).map(c => c.slug)).size, 6);
  for (const collection of Object.values(portfolio.collections)) {
    assert.deepEqual(collection.sections.flatMap(s => s.photos), collection.photos);
    assert.equal(new Set(collection.photos).size, collection.photos.length);
    for (const id of collection.photos) {
      const photo = portfolio.photos[id];
      assert.ok(photo.alt && photo.width > 0 && photo.height > 0);
      for (const variant of photo.variants) assert.equal(fs.statSync(new URL(`../${variant.src}`, import.meta.url)).size, variant.bytes);
    }
  }
  assert.equal(portfolio.collections.spaces.photos[0], 80);
  assert.match(portfolio.photos[80].variants[0].src, /stone-timber-fireplace/);
  assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /data-collection="spaces"[^>]*><img src="assets\/portfolio\/stone-timber-fireplace-1800.webp"/);
});
