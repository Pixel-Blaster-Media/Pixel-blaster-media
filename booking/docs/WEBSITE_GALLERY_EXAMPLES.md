# Website galleries in booking examples

In **Admin → Pricing → the service's Client examples**, choose **Add website gallery**,
select one of the six galleries, leave **Show sample under → Photos pill** selected,
optionally edit the title, use **Preview gallery**, then **Attach gallery**.
Drone is also available for aerial examples. A complete gallery uses one of the
service's existing eight example slots. No images are uploaded or copied.

If a gallery URL was pasted into **Add photo URL**, choose **Use as website gallery**.
The title, URL and selected photo group are preserved. Gallery links already attached
through **Attach URL → Web page** also open in the booking overlay automatically.
Individual image links still use their existing photo viewer, and other external
links, iGUIDE tours and videos retain their existing behavior.

The overlay uses a native modal dialog with close/Escape/backdrop dismissal,
keyboard focus wrapping and focus restoration. It does not navigate or change
booking selections, draft IDs or available-time choices. Photos load responsively
from their existing public website URLs, in the website's section order.

`portfolio.js` at the repository root remains the canonical gallery source. After
editing its collections or photo metadata, run from `booking/`:

```sh
node scripts/sync-website-galleries.mjs
```

Commit the generated metadata JSON with the website change. This keeps Vercel's
booking-root build self-contained. Unit tests reject stale metadata. The browser
suite exercises the real editor, server action validation, picker and dialog with
in-memory storage and existing image bytes; it never changes live service settings.

```sh
node --test tests/website-galleries.test.mjs
node tests/website-galleries.browser.mjs
```
