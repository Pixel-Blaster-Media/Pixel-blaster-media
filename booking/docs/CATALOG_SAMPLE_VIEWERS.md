# Adding booking samples

Open Admin → Settings → Pricing and the service's **Client examples** editor. Examples are public booking-page content; only use material you have permission to publish. Each service can have eight total examples.

- **Video:** Upload video uses the existing Cloudflare Stream connection. Use existing video shares an uploaded example with another service. Restricted Stream samples play in the booking popup, preserving domain protection.

Video files may be up to **1 GB (1,000,000,000 bytes)** and ten minutes long. The uploader sends resumable chunks and shows progress, Pause, Resume and Cancel. After refreshing, choose the same file again to resume an unfinished upload within its original six-hour window. The window does not restart when you retry. Keep the original file unchanged. When the bytes arrive, the example stays hidden until Stream finishes processing; Check processing retries that check without uploading a second copy. If cancellation cannot be confirmed, retry cancellation before starting another copy.

This uses the existing Stream subscription and does not buy capacity or change a plan. Stream storage and viewing retain their existing usage charges. Upload preparation reserves ten minutes of available storage until processing or expiry. Source files can be 4K; Stream playback is optimized up to 1080p. Keep original masters separately.
- **Photos:** Add photo URL accepts a permanent public HTTPS image URL ending in JPG/JPEG, PNG, WebP, AVIF or GIF, or a Cloudflare Images delivery URL. Give each photo a title, choose Photos or Drone, and confirm permission to publish it. Add one photo at a time; the group becomes a thumbnail gallery with previous/next and arrow-key navigation. This feature attaches hosted image URLs; it does not upload local photo files or enable a public storage bucket. Do not use private delivery or expiring signed URLs.
- **iGUIDE:** Attach URL → Interactive example, paste the existing youriguide.com tour link and choose its sample group. Recognized tour links open in the popup; an original-tour link remains available if the provider cannot load embedded. Other safe external links retain their existing new-tab behavior.

Close or Escape from the popup's controls returns to the original booking control and retains the booking draft. Cross-origin player/tour keyboard events are controlled by the provider; the visible Close button remains available. Empty groups show “No example yet” until you add approved samples. No sample images are populated automatically.
