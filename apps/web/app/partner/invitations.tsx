"use client";

// Venue invitations for the signed-in email. Accepting needs both: signing in with the invited address and the link
// from the invitation email, whose token the database compares by hash (M5.1 review F1). The link opens this page
// with ?invitation=&token=; other open invitations ask the user to use their email link.
import { useAction } from "../../lib/use-action";
import { formatVenueDateTime } from "../../lib/format";
import { Button, Card } from "../../components/ui";

export type Invitation = { invitation_id: string; venue_id: string; venue_name: string; role: string; expires_at: string };
export type InvitationLink = { invitationId: string; token: string };

export function Invitations({ invitations, link }: { invitations: Invitation[]; link?: InvitationLink | null }) {
  const action = useAction();
  if (invitations.length === 0) return null;
  return (
    <Card aria-labelledby="invites-heading" data-testid="invitations">
      <h2 id="invites-heading">Invitations</h2>
      <ul>
        {invitations.map((i) => (
          <li key={i.invitation_id}>
            {i.venue_name} invited you as <strong>{i.role.toLowerCase()}</strong> (until {formatVenueDateTime(i.expires_at)} IST){" "}
            {link?.invitationId === i.invitation_id ? (
              <Button

                type="button"
                disabled={action.busy !== null}
                aria-busy={action.busy === i.invitation_id}
                onClick={() => void action.run(i.invitation_id, "POST", `/api/v1/invitations/${i.invitation_id}/accept`, { token: link.token },
                  { success: "Invitation accepted." })}
                data-testid={`accept-${i.invitation_id}`}
              >
                Accept
              </Button>
            ) : (
              <span data-testid={`use-link-${i.invitation_id}`}>To accept, open the link in your invitation email.</span>
            )}
          </li>
        ))}
      </ul>
      {action.message ? (
        <p className={`status-${action.message.tone}`} role="status">
          {action.message.text}
        </p>
      ) : null}
    </Card>
  );
}
