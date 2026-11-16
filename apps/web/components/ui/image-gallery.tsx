"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { VenuePhoto } from "../venue-photo";

export interface GalleryPhoto {
  id: string;
  alt_text: string;
}

export function ImageGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const close = useCallback(() => setActiveIndex(null), []);
  const prev = useCallback(() => {
    setActiveIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
  }, [photos.length]);
  const next = useCallback(() => {
    setActiveIndex((i) => (i === null ? null : (i + 1) % photos.length));
  }, [photos.length]);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, close, prev, next]);

  if (photos.length === 0) return null;

  const active = activeIndex !== null ? photos[activeIndex] : null;

  return (
    <>
      <div className="photo-strip" data-testid="venue-photos">
        {photos.map((p, index) => (
          <button
            key={p.id}
            type="button"
            className="ss-gallery-thumb"
            onClick={() => setActiveIndex(index)}
            aria-label={`View photo ${index + 1} of ${photos.length}: ${p.alt_text}`}
          >
            <VenuePhoto mediaId={p.id} alt={p.alt_text} width={320} height={200} className="strip-photo" />
          </button>
        ))}
      </div>

      {active && activeIndex !== null ? (
        <div className="ss-backdrop" role="presentation" onClick={close}>
          <div className="ss-lightbox" role="dialog" aria-modal="true" aria-label="Venue photo gallery" onClick={(e) => e.stopPropagation()}>
            <div className="ss-lightbox__head">
              <span>
                {activeIndex + 1} / {photos.length}
              </span>
              <button type="button" className="ss-icon-btn" onClick={close} aria-label="Close gallery">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="ss-lightbox__media">
              <VenuePhoto mediaId={active.id} alt={active.alt_text} width={960} height={600} className="ss-lightbox__img" />
            </div>
            <p className="ss-lightbox__caption">{active.alt_text}</p>
            {photos.length > 1 ? (
              <div className="ss-lightbox__nav">
                <button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={prev} aria-label="Previous photo">
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </button>
                <button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={next} aria-label="Next photo">
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
