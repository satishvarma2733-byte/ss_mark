export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <h1>Loading...</h1>
      <div className="grid">
        <div className="skeleton" aria-hidden="true" />
        <div className="skeleton" aria-hidden="true" />
        <div className="skeleton" aria-hidden="true" />
      </div>
    </main>
  );
}
