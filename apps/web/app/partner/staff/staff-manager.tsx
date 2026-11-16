"use client";

// P08 - Figma "C · Partner desktop · Team and permissions": the venue team (members and open invitations), the role
// boundaries the server enforces, and an invitation form. Managers invite staff; owners can also invite managers.
import { useState, type FormEvent } from "react";
import { formatVenueDateTime } from "../../../lib/format";
import type { StaffList } from "../../../lib/partner-types";
import { useAction } from "../../../lib/use-action";
import { TableScroll } from "../../../lib/table-scroll";
import { Button, Card, StatusPill } from "../../../components/ui";

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", MANAGER: "Venue manager", STAFF: "Front desk" };
const ACCESS: Record<string, string> = {
  OWNER: "Operations + owner finance",
  MANAGER: "Bookings, inventory, profile",
  STAFF: "Arrivals, check-out, calendar"
};

const BOUNDARIES: [string, string, string, string][] = [
  ["Validate arrival / turnover", "Allowed", "Allowed", "Allowed"],
  ["Edit inventory / venue drafts", "No", "Allowed", "Allowed"],
  ["Read earnings totals", "No", "Read-only", "Allowed"],
  ["Payout setup", "No", "No", "Owner only"],
  ["Invite managers", "No", "No", "Owner only"]
];

export function StaffManager({ venueId, venueName, staff }: { venueId: string; venueName: string; staff: StaffList }) {
  const invite = useAction();
  const revoke = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"STAFF" | "MANAGER">("STAFF");

  async function send(event: FormEvent) {
    event.preventDefault();
    const result = await invite.run("invite", "POST", `/api/v1/partner/venues/${venueId}/staff-invitations`, { email, role },
      { idempotent: true, success: "Invitation sent. They accept it after signing in with that email." });
    if (result.ok) setEmail("");
  }

  return (
    <div className="partner-layout">
      <div className="book-main">
        <Card className="book-card" aria-labelledby="members-heading">
          <h2 id="members-heading">Your venue team</h2>
          <TableScroll label="Venue team">
            <table data-testid="staff-members">
              <thead>
                <tr>
                  <th scope="col">Team member</th>
                  <th scope="col">Role</th>
                  <th scope="col">Access</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody data-testid="open-invitations">
                {staff.members.map((m) => (
                  <tr key={m.membership_id} className={m.is_self ? "row-highlight" : undefined}>
                    <td>
                      <strong>
                        {m.display_name ?? m.email ?? "Unknown"} {m.is_self ? "(you)" : ""}
                      </strong>
                    </td>
                    <td>{ROLE_LABEL[m.role] ?? m.role}</td>
                    <td>{ACCESS[m.role] ?? ""}</td>
                    <td>Active{m.accepted_at ? ` · since ${formatVenueDateTime(m.accepted_at)}` : ""}</td>
                    <td>
                      {!m.is_self && (m.role === "STAFF" || staff.can_invite_managers) ? (
                        <button className="text-link" type="button" disabled={revoke.busy !== null} data-testid={`revoke-${m.email}`}
                          onClick={() => void revoke.run(m.membership_id, "DELETE", `/api/v1/partner/venues/${venueId}/staff/${m.membership_id}`,
                            { expected_version: m.version }, { success: "Access removed." })}>
                          Remove access
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {staff.invitations.map((i) => (
                  <tr key={i.invitation_id}>
                    <td>
                      <strong>{i.email}</strong>
                    </td>
                    <td>{ROLE_LABEL[i.role] ?? i.role}</td>
                    <td>{i.status === "EXPIRED" ? "Invitation expired" : `Invitation open until ${formatVenueDateTime(i.expires_at)} IST`}</td>
                    <td>{i.status === "EXPIRED" ? "Expired" : "Invited"}</td>
                    <td>
                      <button className="text-link" type="button" disabled={revoke.busy !== null}
                        onClick={() => void revoke.run(i.invitation_id, "DELETE", `/api/v1/partner/invitations/${i.invitation_id}`, undefined, { success: "Invitation withdrawn." })}>
                        Withdraw
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="book-note">Removing access or withdrawing an invitation takes effect at once and is recorded in the audit log.</p>
          {revoke.message ? (
            <p className={`book-when status-${revoke.message.tone}`} role="status">
              {revoke.message.text}
            </p>
          ) : null}
        </Card>

        <Card className="book-card" aria-labelledby="bounds-heading">
          <h2 id="bounds-heading">Permission boundaries</h2>
          <TableScroll label="Permission boundaries">
            <table>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Front desk</th>
                  <th scope="col">Manager</th>
                  <th scope="col">Owner</th>
                </tr>
              </thead>
              <tbody>
                {BOUNDARIES.map(([capability, ...cells]) => (
                  <tr key={capability}>
                    <th scope="row">{capability}</th>
                    {cells.map((c, i) => (
                      <td key={i}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="book-note">The server checks every action against these roles; this page only shows them.</p>
        </Card>
      </div>

      <div className="book-side">
        <form className="card book-card" onSubmit={(e) => void send(e)} aria-labelledby="inv-heading">
          <h2 id="inv-heading">Invite a teammate</h2>
          <div className="field">
            <label className="field-label" htmlFor="invite-email">
              Work email
            </label>
            <input id="invite-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
              data-testid="invite-email" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="invite-role">
              Role
            </label>
            <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "MANAGER")}>
              <option value="STAFF">Front desk · Arrivals and calendar</option>
              {staff.can_invite_managers ? <option value="MANAGER">Venue manager · Operations</option> : null}
            </select>
          </div>
          <div className="field">
            <span className="field-label" id="scope-label">
              Venue scope
            </span>
            <p className="input input-static" aria-labelledby="scope-label">
              {venueName} only
            </p>
          </div>
          <StatusPill tone="sage">
            <img src="/design/status-dot-brand.svg" alt="" width={5} height={5} />
            No finance permissions
          </StatusPill>
          <p className="field-hint">
            The invitation grants no access until it is accepted from the emailed link. Owner and payout rights cannot be added through an invitation.
          </p>
          <Button type="submit" disabled={invite.busy !== null} data-testid="invite-send">
            Send invitation
          </Button>
          {invite.message ? (
            <p className={`book-when status-${invite.message.tone}`} role="status">
              {invite.message.text}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
