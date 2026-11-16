import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main>
      <section className="message-page">
        <span className="message-icon" aria-hidden="true">
          <Compass size={28} />
        </span>
        <h1>We could not find that page</h1>
        <p className="muted">The link may be old, or the page may have moved. Nothing was booked or charged.</p>
        <div className="heading-actions">
          <Link className="button" href="/venues">
            Explore spaces
          </Link>
          <Link className="button secondary" href="/bookings">
            My bookings
          </Link>
        </div>
      </section>
    </main>
  );
}
