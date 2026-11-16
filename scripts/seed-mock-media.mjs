// Uploads the mock venue photos (supabase/mock-media) into the LOCAL venue-media bucket so the APPROVED venue_media
// rows from supabase/seed-design-venues.sql have real files. Local only: uses `supabase storage cp --local`.
// Run after `pnpm db:reset` (or after applying seed-design-venues.sql to a running database): pnpm db:mock-media
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PHOTOS = [
  ["22222222-2222-4222-8222-000000000101", "44444444-4444-4444-8444-000000000101", "verandah-house.jpg"],
  ["22222222-2222-4222-8222-000000000102", "44444444-4444-4444-8444-000000000102", "palm-room.jpg"],
  ["22222222-2222-4222-8222-000000000103", "44444444-4444-4444-8444-000000000103", "copper-yard.jpg"],
  ["22222222-2222-4222-8222-000000000104", "44444444-4444-4444-8444-000000000104", "chapter-and-co.jpg"]
];

let failures = 0;
for (const [venueId, mediaId, file] of PHOTOS) {
  const source = join(root, "supabase", "mock-media", file);
  if (!existsSync(source)) {
    console.error(`missing ${source}`);
    failures += 1;
    continue;
  }
  const target = `ss:///venue-media/${venueId}/${mediaId}.jpg`;
  // Every argument is a constant from this file. The CLI needs its standard output (it fails when that is discarded).
  const command = `pnpm exec supabase storage cp "supabase/mock-media/${file}" "${target}" --local --experimental --content-type image/jpeg`;
  try {
    execSync(command, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    console.info(`uploaded ${file} -> venue-media/${venueId}/${mediaId}.jpg`);
  } catch (error) {
    const message = `${error.stdout ?? ""}${error.stderr ?? ""}` || String(error.message);
    // Re-running is fine: an existing object is reported and left in place.
    if (/already exists|Duplicate/i.test(message)) console.info(`exists ${file}`);
    else {
      console.error(`failed ${file}: ${message.trim().split("\n").pop()}`);
      failures += 1;
    }
  }
}
process.exit(failures === 0 ? 0 : 1);
