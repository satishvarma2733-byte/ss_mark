import { partnerAddMedia } from "@simply-sit/db";
import { venueUploadRoute } from "../../../../../../../lib/venue-upload";

export const dynamic = "force-dynamic";

// POST /api/v1/partner/venues/{id}/media - add a venue photo (multipart `file` + `alt_text`); PENDING until a platform
// admin approves it. Upload rules: lib/venue-upload.ts.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return venueUploadRoute(request, context.params, partnerAddMedia);
}
