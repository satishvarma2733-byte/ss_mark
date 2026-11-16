// Shapes returned by app.partner_venue_overview / partner_staff / partner_calendar / partner_booking_detail (M4.3).
export type Rate = { hourly_paise: number; rate_version: number; effective_from: string } | null;

export type PartnerResource = {
  id: string;
  label: string;
  capacity: number;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
  operational_state: string;
  pause_reason: string | null;
  version: number;
  current_rate: Rate;
  next_rate: Rate;
};

export type PolicyDraft = Record<string, unknown> & { id: string; version: number; policy_version: number; submitted_at: string | null; review_reason: string | null };

export type VenueOverview = {
  venue: {
    id: string; name: string; slug: string; description: string; address: string; locality: string; category_code: string;
    timezone: string; status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "PAUSED" | "REJECTED"; status_reason: string | null;
    version: number; submitted_at: string | null; lat: number; lng: number; is_synthetic: boolean;
  };
  role: "OWNER" | "MANAGER";
  active_policy: Record<string, unknown> | null;
  draft_policy: PolicyDraft | null;
  resources: PartnerResource[];
  hours: { weekday: number; opens_local: string; closes_local: string; closes_next_day: boolean }[];
  closures: { id: string; resource_id: string; resource_label: string; starts_at: string; ends_at: string; reason: string }[];
  media: { id: string; alt_text: string; status: "PENDING" | "APPROVED" | "REJECTED"; sort_order: number }[];
  amenities: { code: string; details: string | null; verified: boolean }[];
  tags: { group: "REQUIREMENT" | "ENVIRONMENT"; code: string }[];
  publication_gaps: string[];
};

export type StaffList = {
  members: { membership_id: string; role: string; status: string; email: string | null; display_name: string | null; accepted_at: string | null; version: number; is_self: boolean }[];
  invitations: { invitation_id: string; email: string; role: string; status: string; expires_at: string }[];
  can_invite_managers: boolean;
};

export type CalendarData = {
  resources: { id: string; label: string; capacity: number; status: string; operational_state: string; version: number }[];
  bookings: { booking_id: string; public_ref: string; status: string; hold_active: boolean; start_at: string; end_at: string; party_size: number; resource_id: string; version: number }[];
  closures: { id: string; resource_id: string; starts_at: string; ends_at: string; reason: string }[];
  can_manage: boolean;
  server_now: string;
};

export type PartnerBooking = {
  booking_id: string; venue_id: string; public_ref: string; status: string; start_at: string; end_at: string; party_size: number;
  resource_label: string; guest_name: string | null; checked_in_at: string | null; checked_out_at: string | null; cancelled_at: string | null;
  version: number; grace_minutes: number; total_paise: number | null; can_manage: boolean; server_now: string;
};

export const GAP_LABEL: Record<string, string> = {
  description: "A description of at least 30 characters",
  policy: "Food, cancellation and house rules",
  priced_table: "At least one active table with a price",
  hours: "Opening hours",
  photo: "At least one photo",
  requirement_tag: "At least one 'good for' use (work, meet, ...)"
};

export const VENUE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft - not visible to customers",
  PENDING_REVIEW: "Waiting for Simply Sit review",
  PUBLISHED: "Live - customers can book",
  PAUSED: "Paused - no new bookings",
  REJECTED: "Not approved"
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
