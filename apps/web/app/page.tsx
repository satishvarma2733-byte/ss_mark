import { Info } from "lucide-react";
import { SearchForm } from "./search-form";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ state?: string }>;

// C01 - search by pilot area or approximate location, date, start time, duration, party size and use case.
// Layout follows Figma "Web · Discover and results" (introduction and search card; results appear on /venues).
// ?state=error is a demonstration switch so the error screen can be inspected.
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  if ((await searchParams).state === "error") throw new Error("Demonstration error: page could not be loaded.");
  return (
    <main>
      <div className="discover-intro">
        <div>
          <h1>A place for your next good hour.</h1>
          <p className="lede">
            Cafés, restaurants, hotels, breweries, lounges and workspaces. Book the table, not a compulsory meal. Whether outside
            food or delivery is allowed depends on each venue and is shown before you book.
          </p>
        </div>
        <a className="area-link" href="/venues?area=koramangala">
          Bengaluru · Explore the neighbourhood
        </a>
      </div>
      <SearchForm initial={{}} />
      <div className="notice info home-note">
        <Info size={19} aria-hidden="true" />
        <div>
          <strong>Synthetic demo data</strong>
          <p>
            Listings and prices are synthetic demo data. <a href="/venues?area=koramangala">Browse all demo venues</a>
          </p>
        </div>
      </div>
    </main>
  );
}
