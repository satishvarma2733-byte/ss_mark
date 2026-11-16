import { describe, expect, it } from "vitest";
import { salesState } from "./sales-state";

describe("sales state", () => {
  const status = { bookings_open: true, extensions_open: false, native_min_version: null };

  it("follows each switch while the app version is supported", () => {
    expect(salesState(status, "0.1.0")).toEqual({ bookings: "open", extensions: "paused", minimumVersion: null });
  });

  it("asks an app older than the server minimum to update, whatever the switches say", () => {
    expect(salesState({ ...status, native_min_version: "0.2.0" }, "0.1.9")).toEqual({ bookings: "update", extensions: "update", minimumVersion: "0.2.0" });
    expect(salesState({ ...status, native_min_version: "0.2.0" }, "0.2.0")).toMatchObject({ bookings: "open" });
  });
});
