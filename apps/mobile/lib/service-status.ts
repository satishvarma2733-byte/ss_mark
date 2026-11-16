// Release switches and app version support (M6). Read when a booking screen opens. The server enforces both, so this
// only explains a paused or out-of-date state before the customer starts; if the status cannot be read, nothing is
// blocked here.
import { useEffect, useState } from "react";
import { salesState, type SalesState } from "./sales-state";
import { api, appVersion } from "./api";

export function useSalesState(): SalesState | null {
  const [state, setState] = useState<SalesState | null>(null);
  useEffect(() => {
    let live = true;
    api?.getServiceStatus().then((status) => live && setState(salesState(status, appVersion))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return state;
}
