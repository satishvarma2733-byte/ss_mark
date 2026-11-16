// Portal pages load account- and venue-scoped data; the customer "Loading spaces" placeholder does not fit here.
export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <h1>Loading...</h1>
      <div className="skeleton" aria-hidden="true" />
    </main>
  );
}
