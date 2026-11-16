import { describe, expect, it } from "vitest";
import { CURRENT_POLICY_VERSION, getPolicy } from "./policy";
import { quoteTable } from "./quote";

describe("booking policy versions", () => {
  it("serves the proposed pilot defaults under an explicit version", () => {
    const policy = getPolicy();
    expect(policy.version).toBe(CURRENT_POLICY_VERSION);
    expect(policy.status).toBe("proposed");
    expect(policy).toMatchObject({
      minimumMinutes: 60,
      incrementMinutes: 30,
      maximumMinutes: 240,
      holdMinutes: 5,
      cleaningBufferMinutes: 10,
      fullRefundCutoffMinutes: 120,
      timezone: "Asia/Kolkata"
    });
  });

  it("fails closed on an unknown version instead of falling back to defaults", () => {
    expect(() => getPolicy("approved-2099-01-01")).toThrow("Unknown booking policy version");
    expect(() => quoteTable({ pricePerBlockPaise: 100, durationMinutes: 60, policyVersion: "missing" })).toThrow();
  });

  it("cannot be mutated at runtime", () => {
    const policy = getPolicy();
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
