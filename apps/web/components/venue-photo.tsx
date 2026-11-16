"use client";

// Approved venue photo served by /api/v1/media/{id}. If the file is missing or blocked (for example a record whose
// upload never reached storage), the image is replaced by a neutral placeholder instead of a broken-image icon.
import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

export function VenuePhoto({
  mediaId,
  alt,
  className,
  width,
  height,
  placeholderText = "Photo unavailable"
}: {
  mediaId: string | null;
  alt: string;
  className?: string;
  width: number;
  height: number;
  placeholderText?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered image can fail before React attaches onError; check its state once mounted.
  useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, []);
  if (!mediaId || failed) {
    return (
      <div className={`${className ?? ""} placeholder`} role="img" aria-label={placeholderText}>
        <ImageOff size={22} aria-hidden="true" />
        <span aria-hidden="true">{placeholderText}</span>
      </div>
    );
  }
  return (
    <img
      ref={ref}
      className={className}
      src={`/api/v1/media/${mediaId}`}
      alt={alt}
      loading="lazy"
      width={width}
      height={height}
      onError={() => setFailed(true)}
    />
  );
}
