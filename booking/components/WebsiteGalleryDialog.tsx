"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { WebsiteGallery, WebsiteGalleryPhoto } from "@/lib/booking/website-galleries";
import "./website-gallery.css";

export default function WebsiteGalleryDialog({ gallery, returnFocus, onClose, contextLabel }: {
  gallery: WebsiteGallery;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  contextLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (!returnFocus?.isConnected) return;
      const visible = (button: HTMLElement) => button.getClientRects().length > 0 && !button.closest("details:not([open])");
      const owner = returnFocus.closest("article");
      const counterpart = returnFocus.dataset.bookingExample
        ? Array.from(owner?.querySelectorAll<HTMLElement>("[data-booking-example]") ?? [])
          .find(button => button.dataset.bookingExample === returnFocus.dataset.bookingExample && visible(button))
        : undefined;
      const fallback = Array.from(owner?.querySelectorAll<HTMLElement>(":scope > details > summary") ?? [])
        .find(summary => summary.getClientRects().length > 0);
      (visible(returnFocus) ? returnFocus : counterpart ?? fallback)?.focus({ preventScroll: true });
    };
  }, [gallery.slug, returnFocus]);

  return <dialog ref={dialog} className="website-gallery-dialog" aria-labelledby={`${id}-title`}
    onClose={event => { if (!event.currentTarget.open) onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
    <header className="website-gallery-header">
      <div><h2 id={`${id}-title`}>{gallery.label}</h2><p>{contextLabel ?? gallery.title} · {gallery.count} photographs</p></div>
      <button type="button" aria-label="Close website gallery" onClick={() => dialog.current?.close()}>Close <span aria-hidden="true">×</span></button>
    </header>
    <div className="website-gallery-body">
      <p className="website-gallery-description">{gallery.description}</p>
      {gallery.sections.length > 1 ? <nav className="website-gallery-jumps" aria-label="Gallery sections">
        {gallery.sections.map((section, index) => <button key={section.title} type="button" onClick={() => {
          headings.current[index]?.focus({ preventScroll: true });
          headings.current[index]?.scrollIntoView({ block: "start" });
        }}>{section.title}</button>)}
      </nav> : null}
      {gallery.sections.map((section, sectionIndex) => <section key={section.title} className="website-gallery-section" aria-labelledby={`${id}-section-${sectionIndex}`}>
        <h3 id={`${id}-section-${sectionIndex}`} tabIndex={-1} ref={element => { headings.current[sectionIndex] = element; }}>{section.title}</h3>
        <div className="website-gallery-grid">
          {section.photos.map((photo, index) => <GalleryPhoto key={photo.id} photo={photo}
            eager={sectionIndex === 0 && index === 0}
            wide={index === 0 || (index === section.photos.length - 1 && section.photos.length % 2 === 0)} />)}
        </div>
      </section>)}
      <footer className="website-gallery-footer">
        <button type="button" onClick={() => dialog.current?.close()}>Done viewing photos</button>
        <a href={gallery.url} target="_blank" rel="noopener noreferrer">Open gallery on the website</a>
      </footer>
    </div>
  </dialog>;
}

function GalleryPhoto({ photo, eager, wide }: { photo: WebsiteGalleryPhoto; eager: boolean; wide: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className={wide ? "website-gallery-wide" : undefined}>
    {failed ? <p role="status">This photo could not load. You can continue browsing or open the gallery on the website.</p> :
      /* Existing optimized website variants remain on the website's image host. */
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={photo.src} srcSet={photo.srcSet}
        sizes={wide ? "(max-width: 600px) calc(100vw - 48px), 900px" : "(max-width: 600px) calc(100vw - 48px), 440px"}
        width={photo.width} height={photo.height} alt={photo.alt} loading={eager ? "eager" : "lazy"}
        decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </figure>;
}
