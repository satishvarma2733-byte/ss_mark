import { PortalBlocked, gatePortal } from "../../lib/portal-page";
import { StaffArrivals } from "./staff-arrivals";
import { StaffExtensions } from "./staff-extensions";

export const dynamic = "force-dynamic";

// P02/P06 staff arrivals. Signed-in, assigned, MFA-verified staff only; every action is re-checked by the database.
export default async function StaffArrivalsPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const gate = await gatePortal("/staff", (me) => me.venue_memberships.length > 0);
  if (gate.state !== "ok") return <PortalBlocked gate={gate} />;
  const { venue } = await searchParams;
  const memberships = gate.me.venue_memberships;
  const current = memberships.find((m) => m.venue_id === venue) ?? memberships[0]!;

  return (
    <main>
      <h1>Staff arrivals</h1>
      {memberships.length > 1 ? (
        <nav aria-label="Venue" className="view-toggle">
          {memberships.map((m) => (
            <a key={m.venue_id} href={`/staff?venue=${m.venue_id}`} aria-current={m.venue_id === current.venue_id ? "page" : undefined}>
              {m.venue_name}
            </a>
          ))}
        </nav>
      ) : null}
      <p className="lede">
        {current.venue_name} ({current.role.toLowerCase()})
      </p>
      <StaffExtensions venueId={current.venue_id} />
      <StaffArrivals venueId={current.venue_id} />
    </main>
  );
}
