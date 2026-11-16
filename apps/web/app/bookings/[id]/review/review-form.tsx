"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "../../../../lib/use-action";
import { Button } from "../../../../components/ui";

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const action = useAction();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run("review", "POST", `/api/v1/bookings/${bookingId}/reviews`,
      { rating, ...(body.trim() ? { body: body.trim() } : {}) }, { idempotent: true, success: "Thanks for your review." });
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)} aria-labelledby="rating-legend">
      <fieldset>
        <legend id="rating-legend">How was it?</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} style={{ marginRight: 12 }}>
            <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} required data-testid={`rating-${n}`} /> {n}
          </label>
        ))}
      </fieldset>
      <label htmlFor="review-body">Tell others about it (optional)</label>
      <textarea id="review-body" className="input" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)}
        data-testid="review-body" />
      <p className="food-note">Please do not include phone numbers or other personal details. Reviews are checked before they appear.</p>
      {action.message ? <p className={`status-${action.message.tone}`} role="status">{action.message.text}</p> : null}
      <Button type="submit" disabled={action.busy !== null || rating === 0} data-testid="review-submit">
        Send review
      </Button>
    </form>
  );
}
