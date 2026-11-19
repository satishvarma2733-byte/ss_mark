import { partnerAddLogo } from "@simply-sit/db";
import { venueUploadRoute } from "../../../../../../../lib/venue-upload";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/logo - upload or replace the venue logo (multipart `file` + `alt_text`). Same rules
// and approval flow as photos; the current approved logo stays visible until the replacement is approved. Remove with
// DELETE /api/v1/partner/media/{id}.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return venueUploadRoute(request, context.params, partnerAddLogo);
}
