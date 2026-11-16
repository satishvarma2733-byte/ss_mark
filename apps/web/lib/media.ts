// Venue photos in the private `venue-media` Storage bucket. Server-only. Files are checked by their bytes (not the
// client's MIME claim) and written/read with the caller's own token, so Storage policies apply the same membership and
// approval rules as the database (migration 20261103000100). No service credential is used.
import { DomainError } from "@simply-sit/db";
import { supabaseConfig } from "./auth/supabase";

export type ImageKind = { ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" };

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return { ext: "png", mime: "image/png" };
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

const objectUrl = (path: string) => `${supabaseConfig().url}/storage/v1/object/${path}`;

export async function uploadVenueObject(key: string, bytes: Uint8Array, kind: ImageKind, accessToken: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(objectUrl(`venue-media/${key}`), {
      method: "POST",
      headers: {
        apikey: supabaseConfig().key,
        authorization: `Bearer ${accessToken}`,
        "content-type": kind.mime,
        "x-upsert": "false",
        "cache-control": "max-age=300"
      },
      body: Buffer.from(bytes)
    });
  } catch {
    throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "storage" });
  }
  if (response.status === 403 || response.status === 401) throw new DomainError("FORBIDDEN");
  if (!response.ok) throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "storage", status: response.status });
}

// Reads with the viewer's token when signed in, else as the public (anon) role; Storage decides what is visible.
export async function fetchVenueObject(key: string, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = { apikey: supabaseConfig().key };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(objectUrl(`authenticated/venue-media/${key}`), { headers, cache: "no-store" });
  } catch {
    throw new DomainError("DEPENDENCY_UNAVAILABLE", { reason: "storage" });
  }
}
