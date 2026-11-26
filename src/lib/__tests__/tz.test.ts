import { describe, expect, it } from "vitest";
import { addDays, isValidTimeZone, localDateKey, localToUtc, parseHHMM, tzOffset } from "../tz";

const iso = (n: number) => new Date(n).toISOString();

describe("tz", () => {
  it("computes offsets", () => {
    expect(tzOffset(Date.parse("2026-11-26T00:00:00Z"), "Asia/Kolkata")).toBe(330 * 60_000);
    expect(tzOffset(Date.parse("2026-07-01T00:00:00Z"), "America/New_York")).toBe(-240 * 60_000);
  });
  it("converts local wall time to UTC", () => {
    expect(iso(localToUtc({ year: 2026, month: 11, day: 26 }, 450, "Asia/Kolkata"))).toBe("2026-11-26T02:00:00.000Z");
  });
  it("shifts nonexistent times forward (spring forward)", () => {
    expect(iso(localToUtc({ year: 2026, month: 3, day: 8 }, 150, "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
  });
  it("resolves ambiguous times to the earlier instant (fall back)", () => {
    expect(iso(localToUtc({ year: 2026, month: 11, day: 1 }, 90, "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(localToUtc({ year: 2026, month: 10, day: 25 }, 150, "Europe/Berlin"))).toBe("2026-10-25T00:30:00.000Z");
  });
  it("misc helpers", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(localDateKey("2026-11-25T19:00:00Z", "Asia/Kolkata")).toBe("2026-11-26");
    expect(parseHHMM("07:30")).toBe(450);
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("7:30")).toBeNull();
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});
