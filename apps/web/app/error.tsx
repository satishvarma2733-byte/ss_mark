"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main>
      <section className="message-page is-error" role="alert">
        <span className="message-icon" aria-hidden="true">
          <TriangleAlert size={28} />
        </span>
        <h1>We could not load this page</h1>
        <p>Nothing was booked or charged. Try again, or come back in a few minutes.</p>
        <p className="food-note">Reference: {error.digest ?? "local-preview"}</p>
        <div className="heading-actions">
          <button className="button" type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
