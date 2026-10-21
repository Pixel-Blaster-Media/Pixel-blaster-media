import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Metadata only: photographs continue to be served by the existing website.
// Keep the booking build self-contained while checking against the canonical source in CI.
const source = readFileSync(new URL('../../portfolio.js', import.meta.url), 'utf8');
const portfolio = JSON.parse(source.replace(/^const portfolio = /, '').replace(/;\s*$/, ''));
const labels = {
  brand: 'Brand & Product', people: 'Portraits & People', spaces: 'Interiors & Architecture',
  lifestyle: 'Commercial & Lifestyle', hospitality: 'Food & Hospitality', property: 'Real Estate & Aerial',
};
const origin = 'https://pixelblastermedia.com/';
const galleries = {};
for (const [key, collection] of Object.entries(portfolio.collections)) {
  if (!labels[key] || !/^[a-z]+(?:-[a-z]+)*$/.test(collection.slug)) throw Error('Unknown website collection');
  const sections = (collection.sections ?? [{ title: 'Photographs', photos: collection.photos }]).map(section => ({
    title: section.title,
    photos: section.photos.map(id => {
      const photo = portfolio.photos[id];
      if (!photo || !photo.variants.every(v => /^assets\/portfolio\/[a-z0-9-]+\.webp$/.test(v.src))) throw Error('Invalid website photograph');
      return {
        id: String(id), alt: photo.alt, width: photo.width, height: photo.height,
        src: new URL(photo.variants.at(-1).src, origin).href,
        srcSet: photo.variants.map(v => `${new URL(v.src, origin).href} ${v.width}w`).join(', '),
      };
    }),
  }));
  galleries[collection.slug] = {
    slug: collection.slug, label: labels[key], title: collection.title, description: collection.description,
    url: `${origin}#gallery/${collection.slug}`, count: sections.reduce((n, s) => n + s.photos.length, 0), sections,
  };
}
const output = JSON.stringify(galleries, null, 2) + '\n';
const target = new URL('../lib/booking/website-galleries.generated.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw Error('Website gallery metadata is stale. Run node scripts/sync-website-galleries.mjs from booking/.');
  console.log('Booking gallery metadata matches all six website collections.');
} else {
  writeFileSync(target, output);
  console.log(`Updated ${fileURLToPath(target)} (metadata only; no image copies).`);
}
