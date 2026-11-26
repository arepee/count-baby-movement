import { describe, expect, it } from "vitest";
import {
  coveredStarts,
  formatSlotLabel,
  formatTimeRange,
  isInSleepWindow,
  isValidSlotStart,
  MAX_PENDING,
  pendingSlots,
  slotContaining,
  slotsBetween,
  type SlotSettings,
} from "../slots";
import type { Slot } from "../types";

const IST: SlotSettings = { sleepStart: "23:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" };
const NY: SlotSettings = { ...IST, timezone: "America/New_York" };
const H = 3_600_000;
const ms = (s: string) => new Date(s).getTime();
const dur = (s: Slot) => ms(s.end) - ms(s.start);

function expectTiling(slots: Slot[]) {
  for (let i = 0; i < slots.length; i++) {
    expect(dur(slots[i])).toBeGreaterThan(0);
    if (!slots[i].isSleep) expect(dur(slots[i])).toBeLessThanOrEqual(H);
    if (i > 0) expect(slots[i].start).toBe(slots[i - 1].end);
    if (i > 0) expect(slots[i].isSleep && slots[i - 1].isSleep).toBe(false);
  }
}

describe("slotContaining (Asia/Kolkata)", () => {
  it("returns hourly awake slots anchored to wake time", () => {
    // 10:00 IST = 04:30Z
    expect(slotContaining("2026-11-26T04:30:00Z", IST)).toEqual({
      start: "2026-11-26T04:00:00.000Z", // 09:30 IST
      end: "2026-11-26T05:00:00.000Z",
      isSleep: false,
    });
  });

  it("start is inclusive and end exclusive", () => {
    expect(slotContaining("2026-11-26T04:00:00Z", IST).start).toBe("2026-11-26T04:00:00.000Z");
    expect(slotContaining("2026-11-26T04:59:59.999Z", IST).start).toBe("2026-11-26T04:00:00.000Z");
    expect(slotContaining("2026-11-26T05:00:00Z", IST).start).toBe("2026-11-26T05:00:00.000Z");
  });

  it("first awake slot is 07:30-08:30", () => {
    expect(slotContaining("2026-11-26T02:00:00Z", IST)).toEqual({
      start: "2026-11-26T02:00:00.000Z",
      end: "2026-11-26T03:00:00.000Z",
      isSleep: false,
    });
  });

  it("the sleep window is a single slot crossing midnight", () => {
    const night = { start: "2026-11-25T18:00:00.000Z", end: "2026-11-26T02:00:00.000Z", isSleep: true };
    expect(slotContaining("2026-11-25T18:00:00Z", IST)).toEqual(night); // 23:30 IST
    expect(slotContaining("2026-11-25T20:30:00Z", IST)).toEqual(night); // 02:00 IST next day
    expect(slotContaining("2026-11-26T01:59:00Z", IST)).toEqual(night); // 07:29 IST
    expect(isInSleepWindow("2026-11-25T20:30:00Z", IST)).toBe(true);
    expect(isInSleepWindow("2026-11-26T02:00:00Z", IST)).toBe(false);
  });

  it("last awake slot before sleep is 22:30-23:30", () => {
    expect(slotContaining("2026-11-26T17:45:00Z", IST)).toEqual({
      start: "2026-11-26T17:00:00.000Z",
      end: "2026-11-26T18:00:00.000Z",
      isSleep: false,
    });
  });

  it("truncates the last awake slot when the window is not whole hours", () => {
    const s = { ...IST, sleepStart: "23:00" };
    // 22:30-23:00 IST
    expect(slotContaining("2026-11-26T17:10:00Z", s)).toEqual({
      start: "2026-11-26T17:00:00.000Z",
      end: "2026-11-26T17:30:00.000Z",
      isSleep: false,
    });
    expect(slotContaining("2026-11-26T17:30:00Z", s)).toEqual({
      start: "2026-11-26T17:30:00.000Z",
      end: "2026-11-27T02:00:00.000Z",
      isSleep: true,
    });
  });

  it("handles a sleep window that does not cross midnight", () => {
    const s = { ...IST, sleepStart: "01:00", sleepEnd: "09:00" };
    const day = slotsBetween("2026-11-26T03:30:00Z", "2026-11-27T03:30:00Z", s); // 09:00 IST to 09:00 IST
    expect(day).toHaveLength(17);
    expect(day[0]).toMatchObject({ start: "2026-11-26T03:30:00.000Z", isSleep: false });
    expect(day[15]).toMatchObject({ start: "2026-11-26T18:30:00.000Z", end: "2026-11-26T19:30:00.000Z" }); // 00:00-01:00
    expect(day[16]).toEqual({ start: "2026-11-26T19:30:00.000Z", end: "2026-11-27T03:30:00.000Z", isSleep: true });
    // 03:00 IST on the 27th belongs to the night that started at 01:00 on the 27th
    expect(slotContaining("2026-11-26T21:30:00Z", s).start).toBe("2026-11-26T19:30:00.000Z");
  });

  it("sleepStart == sleepEnd means 24 hourly slots anchored at that minute", () => {
    const s = { ...IST, sleepStart: "07:30", sleepEnd: "07:30" };
    const day = slotsBetween("2026-11-26T02:00:00Z", "2026-11-27T02:00:00Z", s);
    expect(day).toHaveLength(24);
    expect(day.every((x) => !x.isSleep && dur(x) === H)).toBe(true);
    expect(day[0].start).toBe("2026-11-26T02:00:00.000Z");
    expect(isInSleepWindow("2026-11-25T20:30:00Z", s)).toBe(false);
  });

  it("throws on invalid settings or instants", () => {
    expect(() => slotContaining(Date.now(), { ...IST, sleepStart: "25:00" })).toThrow();
    expect(() => slotContaining("nope", IST)).toThrow();
  });
});

describe("tiling", () => {
  const combos: [string, string][] = [
    ["23:30", "07:30"], ["23:00", "07:30"], ["22:15", "06:40"], ["01:00", "09:00"],
    ["07:30", "07:30"], ["00:00", "00:00"], ["02:30", "02:30"], ["12:00", "13:00"],
    ["02:00", "03:00"], ["01:30", "02:30"], ["03:00", "01:59"], ["23:59", "00:00"],
  ];
  const zones = ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Lord_Howe", "UTC"];
  const ranges: [string, string][] = [
    ["2026-03-05T00:00:00Z", "2026-03-12T00:00:00Z"],
    ["2026-10-22T00:00:00Z", "2026-11-04T00:00:00Z"],
    ["2026-03-25T00:00:00Z", "2026-04-08T00:00:00Z"],
  ];

  for (const timezone of zones) {
    for (const [sleepStart, sleepEnd] of combos) {
      it(`${timezone} ${sleepStart}-${sleepEnd} tiles without gaps/overlaps`, () => {
        const s = { sleepStart, sleepEnd, timezone };
        for (const [a, b] of ranges) {
          const slots = slotsBetween(a, b, s);
          expectTiling(slots);
          expect(ms(slots[0].start)).toBeLessThanOrEqual(ms(a));
          expect(ms(slots[slots.length - 1].end)).toBeGreaterThan(ms(b) - 1);
          // every slot is found by slotContaining for its start, middle and last ms
          for (const x of slots) {
            expect(slotContaining(x.start, s)).toEqual(x);
            expect(slotContaining(ms(x.end) - 1, s)).toEqual(x);
            expect(isValidSlotStart(x.start, s)).toBe(true);
          }
        }
      });
    }
  }
});

describe("DST (America/New_York)", () => {
  it("spring forward night (2026-03-08) is 7 hours", () => {
    const night = slotContaining("2026-03-08T08:00:00Z", NY);
    expect(night).toEqual({ start: "2026-03-08T04:30:00.000Z", end: "2026-03-08T11:30:00.000Z", isSleep: true });
    expect(dur(night)).toBe(7 * H);
  });

  it("fall back night (2026-11-01) is 9 hours", () => {
    const night = slotContaining("2026-11-01T06:30:00Z", NY);
    expect(night).toEqual({ start: "2026-11-01T03:30:00.000Z", end: "2026-11-01T12:30:00.000Z", isSleep: true });
    expect(dur(night)).toBe(9 * H);
  });

  it("awake slots keep local :30 alignment on both sides of the change", () => {
    expect(slotContaining("2026-03-07T13:00:00Z", NY).start).toBe("2026-03-07T12:30:00.000Z"); // 7:30 EST
    expect(slotContaining("2026-03-08T12:00:00Z", NY).start).toBe("2026-03-08T11:30:00.000Z"); // 7:30 EDT
    expect(slotContaining("2026-11-01T13:00:00Z", NY).start).toBe("2026-11-01T12:30:00.000Z"); // 7:30 EST
  });

  it("no sleep window: 23 slots on spring-forward day, 25 on fall-back day", () => {
    const s = { ...NY, sleepStart: "00:00", sleepEnd: "00:00" };
    expect(slotsBetween("2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z", s)).toHaveLength(23);
    expect(slotsBetween("2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z", s)).toHaveLength(25);
  });

  it("awake slots crossing the transition stay 1 hour of real time", () => {
    const s = { ...NY, sleepStart: "12:00", sleepEnd: "13:00" }; // awake overnight
    const slots = slotsBetween("2026-03-08T05:00:00Z", "2026-03-08T09:00:00Z", s); // 00:00 EST..05:00 EDT
    expect(slots.map((x) => formatSlotLabel(x, NY.timezone))).toEqual([
      "Sun 12:00 AM – 1:00 AM",
      "Sun 1:00 AM – 3:00 AM",
      "Sun 3:00 AM – 4:00 AM",
      "Sun 4:00 AM – 5:00 AM",
    ]);
    expect(slots.every((x) => dur(x) === H)).toBe(true);
  });
});

describe("isValidSlotStart", () => {
  it("accepts slot starts and rejects others", () => {
    expect(isValidSlotStart("2026-11-26T02:00:00.000Z", IST)).toBe(true); // 07:30
    expect(isValidSlotStart("2026-11-26T07:30:00+05:30", IST)).toBe(true);
    expect(isValidSlotStart("2026-11-25T18:00:00Z", IST)).toBe(true); // 23:30 night
    expect(isValidSlotStart("2026-11-26T02:30:00Z", IST)).toBe(false); // 08:00
    expect(isValidSlotStart("2026-11-25T18:30:00Z", IST)).toBe(false); // 00:00 inside night
    expect(isValidSlotStart("2026-11-26T02:00:00.001Z", IST)).toBe(false);
    expect(isValidSlotStart("garbage", IST)).toBe(false);
  });
});

describe("pendingSlots", () => {
  const settings = { ...IST, trackingStart: "2026-11-26T03:10:00Z" }; // 08:40 IST
  const now = "2026-11-26T06:15:00Z"; // 11:45 IST

  it("lists ended, unentered slots from the slot containing trackingStart, oldest first", () => {
    const p = pendingSlots(now, settings, new Set());
    expect(p.map((x) => x.start)).toEqual([
      "2026-11-26T03:00:00.000Z", // 08:30
      "2026-11-26T04:00:00.000Z",
      "2026-11-26T05:00:00.000Z", // 10:30-11:30; 11:30 still in progress
    ]);
  });

  it("excludes entered slots (any ISO spelling)", () => {
    const p = pendingSlots(now, settings, new Set(["2026-11-26T09:30:00+05:30"]));
    expect(p.map((x) => x.start)).toEqual(["2026-11-26T03:00:00.000Z", "2026-11-26T05:00:00.000Z"]);
  });

  it("a slot ending exactly now is pending", () => {
    expect(pendingSlots("2026-11-26T05:00:00Z", settings, new Set())).toHaveLength(2);
  });

  it("caps at the most recent 72", () => {
    const p = pendingSlots("2026-12-26T00:00:00Z", { ...settings, trackingStart: "2026-11-01T00:00:00Z" }, new Set());
    expect(p).toHaveLength(MAX_PENDING);
    expect(ms(p[71].end)).toBeLessThanOrEqual(ms("2026-12-26T00:00:00Z"));
    expect(ms(p[0].start)).toBeLessThan(ms(p[1].start));
    expect(slotContaining("2026-12-26T00:00:00Z", IST).start).toBe(p[71].end);
  });

  it("includes the night slot once ended", () => {
    const p = pendingSlots("2026-11-27T02:00:00Z", { ...settings, trackingStart: "2026-11-26T17:30:00Z" }, new Set());
    expect(p).toEqual([
      { start: "2026-11-26T17:00:00.000Z", end: "2026-11-26T18:00:00.000Z", isSleep: false },
      { start: "2026-11-26T18:00:00.000Z", end: "2026-11-27T02:00:00.000Z", isSleep: true },
    ]);
  });
});

describe("coveredStarts", () => {
  it("maps entries recorded under an old window onto overlapping current slots", () => {
    const newSettings = { ...IST, sleepStart: "23:00", sleepEnd: "07:00" };
    // Old night 23:30-07:30 IST
    const covered = coveredStarts([{ slotStart: "2026-11-25T18:00:00Z", slotEnd: "2026-11-26T02:00:00Z" }], newSettings);
    expect([...covered]).toEqual(["2026-11-25T17:30:00.000Z", "2026-11-26T01:30:00.000Z"]);
  });
  it("maps an aligned entry to exactly its slot", () => {
    const c = coveredStarts([{ slotStart: "2026-11-26T02:00:00Z", slotEnd: "2026-11-26T03:00:00Z" }], IST);
    expect([...c]).toEqual(["2026-11-26T02:00:00.000Z"]);
  });
});

describe("formatting", () => {
  it("formats awake and night labels", () => {
    expect(formatSlotLabel(slotContaining("2026-11-26T09:10:00Z", IST), IST.timezone)).toBe("Thu 2:30 PM – 3:30 PM");
    expect(formatSlotLabel(slotContaining("2026-11-25T20:00:00Z", IST), IST.timezone)).toBe("Night · 11:30 PM – 7:30 AM");
  });
  it("formats compact ranges", () => {
    expect(formatTimeRange(slotContaining("2026-11-26T09:10:00Z", IST), IST.timezone)).toBe("2:30–3:30 PM");
    expect(formatTimeRange(slotContaining("2026-11-26T06:10:00Z", IST), IST.timezone)).toBe("11:30 AM–12:30 PM");
  });
});
