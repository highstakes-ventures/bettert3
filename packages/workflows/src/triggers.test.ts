import { describe, expect, it } from "vite-plus/test";
import { dueScannerDate, scannerTriggers } from "./triggers.ts";

describe("daily scanner occurrences", () => {
  const enabled = Date.parse("2026-01-01T00:00:00Z");
  it.each([
    ["2026-10-21T04:59:59Z", "2026-10-20"],
    ["2026-10-21T05:00:00Z", "2026-10-21"],
    ["2026-10-24T20:00:00Z", "2026-10-24"],
    ["2026-03-29T22:30:00Z", "2026-03-29"],
    ["2026-10-25T23:30:00Z", "2026-10-25"],
    ["2026-03-29T05:00:00Z", "2026-03-29"],
    ["2026-10-25T06:00:00Z", "2026-10-25"],
  ])("chooses the latest local occurrence at %s", (now, date) =>
    expect(dueScannerDate(Date.parse(now), enabled)).toBe(date),
  );
  it("never backfills a day enabled after its scheduled time", () => {
    const activated = Date.parse("2026-10-21T08:00:00Z");
    expect(dueScannerDate(activated, activated)).toBeNull();
    expect(dueScannerDate(Date.parse("2026-10-22T04:59:00Z"), activated)).toBeNull();
    expect(dueScannerDate(Date.parse("2026-10-22T05:00:00Z"), activated)).toBe("2026-10-22");
  });
  it("runs today's occurrence when enabled before seven", () =>
    expect(
      dueScannerDate(Date.parse("2026-10-21T09:00:00Z"), Date.parse("2026-10-21T04:00:00Z")),
    ).toBe("2026-10-21"));
  it("imports disabled definitions without activating scanners", () =>
    expect(scannerTriggers.every((trigger) => trigger.enabledByDefault === false)).toBe(true));
});
