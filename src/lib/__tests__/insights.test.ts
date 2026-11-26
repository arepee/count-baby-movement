import { describe, expect, it } from "vitest";
import { buildInsights, clampDays, daySlots, pregnancyAge } from "../insights";
import { slotDayKey, slotsBetween } from "../slots";
import type { Entry, Settings, Slot } from "../types";
import { parseDueDate, parseSettings } from "../validate";

const IST: Settings = {
  sleepStart: "23:30",
  sleepEnd: "07:30",
  timezone: "Asia/Kolkata",
  trackingStart: "2026-10-01T00:00:00.000Z",
  initialized: true,
  dueDate: null,
};
const NY: Settings = { ...IST, timezone: "America/New_York" };
// Thursday 26 Nov 2026, 14:30 IST.
const NOW = "2026-11-26T09:00:00.000Z";

let nextId = 1;
type Counts = { k: number; r?: number; o?: number } | "skip" | null;

function entry(slot: Slot, c: Exclude<Counts, null>): Entry {
  const skipped = c === "skip";
  return {
    id: nextId++,
    slotStart: slot.start,
    slotEnd: slot.end,
    isSleep: slot.isSleep,
    kicks: skipped ? 0 : c.k,
    rolls: skipped ? 0 : (c.r ?? 0),
    other: skipped ? 0 : (c.o ?? 0),
    skipped,
    createdAt: slot.end,
    updatedAt: slot.end,
  };
}

/** One entry per ended slot in [from, now) as decided by `fn` (null = not logged). */
function fill(s: Settings, from: string, now: string, fn: (slot: Slot, dayKey: string) => Counts): Entry[] {
  const out: Entry[] = [];
  for (const slot of slotsBetween(from, now, s)) {
    if (new Date(slot.end).getTime() > new Date(now).getTime()) continue;
    if (new Date(slot.start).getTime() < new Date(from).getTime()) continue;
    const c = fn(slot, slotDayKey(slot, s.timezone));
    if (c) out.push(entry(slot, c));
  }
  return out;
}

describe("buildInsights: day attribution (Asia/Kolkata)", () => {
  it("counts the night slot toward the day it ends and sums counts", () => {
    const night: Slot = { start: "2026-11-25T18:00:00.000Z", end: "2026-11-26T02:00:00.000Z", isSleep: true }; // Wed 23:30 – Thu 07:30
    const morning: Slot = { start: "2026-11-26T02:00:00.000Z", end: "2026-11-26T03:00:00.000Z", isSleep: false }; // Thu 07:30
    const lateWed: Slot = { start: "2026-11-25T17:00:00.000Z", end: "2026-11-25T18:00:00.000Z", isSleep: false }; // Wed 22:30
    const skippedThu: Slot = { start: "2026-11-26T03:00:00.000Z", end: "2026-11-26T04:00:00.000Z", isSleep: false };
    const entries = [
      entry(night, { k: 4, r: 2, o: 1 }),
      entry(morning, { k: 3 }),
      entry(lateWed, { k: 5 }),
      entry(skippedThu, "skip"),
    ];
    const r = buildInsights(entries, IST, NOW, 7);
    expect(r.today).toMatchObject({
      key: "2026-11-26",
      kicks: 7,
      rolls: 2,
      other: 1,
      total: 10,
      loggedHours: 9,
      skippedHours: 1,
      night: 7,
    });
    const wed = r.days.find((d) => d.key === "2026-11-25")!;
    expect(wed).toMatchObject({ total: 5, loggedHours: 1, skippedHours: 0, night: null });
    expect(r.now).toBe(NOW);
    expect(r.settings).toBe(IST);
  });

  it("a skipped night gives night=null and counts as skipped hours", () => {
    const night: Slot = { start: "2026-11-25T18:00:00.000Z", end: "2026-11-26T02:00:00.000Z", isSleep: true };
    const r = buildInsights([entry(night, "skip")], IST, NOW, 7);
    expect(r.today).toMatchObject({ total: 0, night: null, loggedHours: 0, skippedHours: 8 });
  });

  it("returns `days` days newest first and omits days before tracking start", () => {
    const r = buildInsights([], IST, NOW, 10);
    expect(r.days.map((d) => d.key)).toEqual([
      "2026-11-26", "2026-11-25", "2026-11-24", "2026-11-23", "2026-11-22",
      "2026-11-21", "2026-11-20", "2026-11-19", "2026-11-18", "2026-11-17",
    ]);
    expect(r.days[3]).toEqual({
      key: "2026-11-23", kicks: 0, rolls: 0, other: 0, total: 0, loggedHours: 0, skippedHours: 0, night: null,
    });
    // Tracking started Tue 24 Nov 15:30 IST.
    const r2 = buildInsights([], { ...IST, trackingStart: "2026-11-24T10:00:00.000Z" }, NOW, 28);
    expect(r2.days.map((d) => d.key)).toEqual(["2026-11-26", "2026-11-25", "2026-11-24"]);
    expect(r2.grid.map((g) => g.key)).toEqual(["2026-11-26", "2026-11-25", "2026-11-24"]);
  });

  it("tracking started inside the sleep window: first day is the wake day", () => {
    // Tue 24 Nov 23:45 IST -> the night belongs to Wed 25.
    const r = buildInsights([], { ...IST, trackingStart: "2026-11-24T18:15:00.000Z" }, NOW, 7);
    expect(r.days.map((d) => d.key)).toEqual(["2026-11-26", "2026-11-25"]);
  });

  it("clamps days to 7..120", () => {
    expect(clampDays(3)).toBe(7);
    expect(clampDays(500)).toBe(120);
    expect(clampDays("14")).toBe(14);
    expect(clampDays(undefined)).toBe(28);
    expect(buildInsights([], IST, NOW, 2).days).toHaveLength(7);
  });

  it("ignores entries that start after now", () => {
    const future: Slot = { start: "2026-11-26T10:00:00.000Z", end: "2026-11-26T11:00:00.000Z", isSleep: false };
    expect(buildInsights([entry(future, { k: 9 })], IST, NOW, 7).today.total).toBe(0);
  });
});

describe("buildInsights: usualByNow / lowerThanUsual", () => {
  // Previous days: night 5, every awake slot 2. By 14:30 the ended slots are the night
  // and 07:30..13:30 (7 awake slots) -> 5 + 14 = 19.
  const history = fill(IST, "2026-11-18T18:00:00.000Z", "2026-11-26T02:00:00.000Z", (slot, key) =>
    key === "2026-11-26" ? null : slot.isSleep ? { k: 5 } : { k: 1, r: 1 },
  );

  it("computes the mean up to the same local time and flags a quiet day", () => {
    // Today: night 1, morning slots all 0 (fully logged).
    const today = fill(IST, "2026-11-25T18:00:00.000Z", NOW, (slot) => (slot.isSleep ? { k: 1 } : { k: 0 }));
    const r = buildInsights([...history, ...today], IST, NOW, 28);
    expect(r.today.usualByNow).toBe(19);
    expect(r.today.usualDays).toBe(7);
    expect(r.today.total).toBe(1);
    expect(r.today.loggedHours).toBe(15); // 8h night + 7 awake hours
    expect(r.today.lowerThanUsual).toBe(true);
  });

  it("is not lower than usual when today is in line", () => {
    const today = fill(IST, "2026-11-25T18:00:00.000Z", NOW, (slot) => (slot.isSleep ? { k: 5 } : { k: 1 }));
    const r = buildInsights([...history, ...today], IST, NOW, 28);
    expect(r.today.total).toBe(12); // 12 >= 9.5
    expect(r.today.lowerThanUsual).toBe(false);
  });

  it("is not lower than usual when less than half of today's hours are logged", () => {
    // Only 2 of the 15 hours ended so far are logged (no night).
    const today = fill(IST, "2026-11-25T18:00:00.000Z", NOW, (slot) =>
      slot.isSleep ? null : slot.start < "2026-11-26T04:00:00.000Z" ? { k: 0 } : null,
    );
    const r = buildInsights([...history, ...today], IST, NOW, 28);
    expect(r.today.usualByNow).toBe(19);
    expect(r.today.lowerThanUsual).toBe(false);
    // Skipped hours don't count as logged either.
    const skippedToday = fill(IST, "2026-11-25T18:00:00.000Z", NOW, () => "skip");
    expect(buildInsights([...history, ...skippedToday], IST, NOW, 28).today.lowerThanUsual).toBe(false);
  });

  it("requires usualByNow >= 10", () => {
    const quiet = fill(IST, "2026-11-18T18:00:00.000Z", "2026-11-26T02:00:00.000Z", (slot, key) =>
      key === "2026-11-26" ? null : slot.isSleep ? { k: 2 } : { k: 1 },
    ); // 2 + 7 = 9 per day
    const today = fill(IST, "2026-11-25T18:00:00.000Z", NOW, () => ({ k: 0 }));
    const r = buildInsights([...quiet, ...today], IST, NOW, 28);
    expect(r.today.usualByNow).toBe(9);
    expect(r.today.lowerThanUsual).toBe(false);
  });

  it("only counts slots ended by the same time of day", () => {
    // Afternoon/evening slots on previous days are huge but end after 14:30 local.
    const lopsided = fill(IST, "2026-11-18T18:00:00.000Z", "2026-11-26T02:00:00.000Z", (slot, key) => {
      if (key === "2026-11-26") return null;
      const lateAwake = !slot.isSleep && new Date(slot.end).getTime() > new Date(`${key}T09:00:00.000Z`).getTime();
      return lateAwake ? { k: 100 } : slot.isSleep ? { k: 5 } : { k: 2 };
    });
    expect(buildInsights(lopsided, IST, NOW, 28).today.usualByNow).toBe(19);
  });

  it("excludes previous days with < 50% of those hours logged", () => {
    // 3 days fully logged with 20 by now (night 6 + 7×2); 4 days with only 1 awake hour logged.
    const mixed = fill(IST, "2026-11-18T18:00:00.000Z", "2026-11-26T02:00:00.000Z", (slot, key) => {
      if (key === "2026-11-26") return null;
      const full = ["2026-11-25", "2026-11-24", "2026-11-23"].includes(key);
      if (full) return slot.isSleep ? { k: 6 } : { k: 2 };
      return !slot.isSleep && slot.start === `${key}T02:00:00.000Z` ? { k: 50 } : null;
    });
    const r = buildInsights(mixed, IST, NOW, 28);
    expect(r.today.usualDays).toBe(3);
    expect(r.today.usualByNow).toBe(20);
  });

  it("is null with fewer than 3 qualifying days (not enough history)", () => {
    const s = { ...IST, trackingStart: "2026-11-23T20:00:00.000Z" }; // Tue 24 Nov 01:30 IST (night -> Tue)
    const entries = fill(s, "2026-11-23T18:00:00.000Z", NOW, (slot, key) =>
      key === "2026-11-26" ? { k: 0 } : slot.isSleep ? { k: 10 } : { k: 5 },
    );
    const r = buildInsights(entries, s, NOW, 28);
    expect(r.days.map((d) => d.key)).toEqual(["2026-11-26", "2026-11-25", "2026-11-24"]);
    expect(r.today.usualDays).toBe(2);
    expect(r.today.usualByNow).toBeNull();
    expect(r.today.lowerThanUsual).toBe(false);
  });

  it("is null before the night has ended (nothing comparable yet)", () => {
    const at3am = "2026-11-25T21:30:00.000Z"; // Thu 03:00 IST
    const r = buildInsights(history, IST, at3am, 28);
    expect(r.today.usualByNow).toBeNull();
    expect(r.today.usualDays).toBe(0);
  });
});

describe("buildInsights: grid and hourAvg", () => {
  it("places awake slots by local start hour, with night separate", () => {
    const entries = [
      entry({ start: "2026-11-26T02:00:00.000Z", end: "2026-11-26T03:00:00.000Z", isSleep: false }, { k: 3 }), // 07:30
      entry({ start: "2026-11-26T03:00:00.000Z", end: "2026-11-26T04:00:00.000Z", isSleep: false }, "skip"), // 08:30
      entry({ start: "2026-11-25T17:00:00.000Z", end: "2026-11-25T18:00:00.000Z", isSleep: false }, { k: 1, o: 1 }), // Wed 22:30
      entry({ start: "2026-11-25T18:00:00.000Z", end: "2026-11-26T02:00:00.000Z", isSleep: true }, { k: 6 }),
      entry({ start: "2026-11-25T02:00:00.000Z", end: "2026-11-25T03:00:00.000Z", isSleep: false }, { k: 7 }), // Wed 07:30
    ];
    const r = buildInsights(entries, IST, NOW, 7);
    expect(r.grid).toHaveLength(7);
    expect(r.grid[0].key).toBe("2026-11-26");
    expect(r.grid[0].cells).toHaveLength(24);
    expect(r.grid[0].cells[7]).toBe(3);
    expect(r.grid[0].cells[8]).toBeNull(); // skipped
    expect(r.grid[0].cells[9]).toBeNull(); // no entry
    expect(r.grid[0].night).toBe(6);
    expect(r.grid[1].cells[22]).toBe(2);
    expect(r.grid[1].cells[7]).toBe(7);
    expect(r.grid[1].night).toBeNull();
    expect(r.hourAvg).toHaveLength(24);
    expect(r.hourAvg[7]).toBe(5); // (3 + 7) / 2
    expect(r.hourAvg[22]).toBe(2);
    expect(r.hourAvg[8]).toBeNull();
    expect(r.hourAvg[0]).toBeNull();
  });

  it("marks today's awake slots that haven't ended (incl. in progress) as future", () => {
    // NOW = Thu 14:30 IST: 07:30..13:30 ended; 14:30 (in progress, ends 15:30) .. 22:30 are future.
    const r = buildInsights([], IST, NOW, 7);
    expect(r.grid[0].future).toHaveLength(24);
    const futureHours = r.grid[0].future.flatMap((f, h) => (f ? [h] : []));
    expect(futureHours).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22]);
    // Past days never have future cells.
    for (const row of r.grid.slice(1)) expect(row.future.every((f) => !f)).toBe(true);
    // Just after a slot ends, it is no longer future.
    const r2 = buildInsights([], IST, "2026-11-26T10:00:00.000Z", 7); // 15:30 IST
    expect(r2.grid[0].future[14]).toBe(false);
    expect(r2.grid[0].future[15]).toBe(true);
    // During the night (03:00 IST) every awake slot of today is still ahead.
    const r3 = buildInsights([], IST, "2026-11-25T21:30:00.000Z", 7);
    expect(r3.grid[0].future.flatMap((f, h) => (f ? [h] : []))).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });
});

describe("buildInsights: weeks", () => {
  // 14 days of data: every slot of day k has total = 1 per awake slot, night 4 (16 awake slots -> 20/day).
  const entries = fill(IST, "2026-11-11T18:00:00.000Z", NOW, (slot) => (slot.isSleep ? { k: 4 } : { k: 1 }));

  it("groups by Monday-start calendar weeks without a due date", () => {
    const r = buildInsights(entries, IST, NOW, 14); // 13..26 Nov; 26 Nov is a Thursday
    expect(r.pregnancy).toBeNull();
    expect(r.weeks).toEqual([
      { label: "23 Nov", week: null, startKey: "2026-11-23", endKey: "2026-11-26", avgPerDay: 20, days: 3 },
      { label: "16 Nov", week: null, startKey: "2026-11-16", endKey: "2026-11-22", avgPerDay: 20, days: 7 },
      { label: "9 Nov", week: null, startKey: "2026-11-13", endKey: "2026-11-15", avgPerDay: 20, days: 3 },
    ]);
  });

  it("groups by pregnancy week with a due date", () => {
    // Due 20 Jan 2027: 55 days away -> 280 - 55 = 225 days = 32w 1d; week 32 began 25 Nov.
    const s = { ...IST, dueDate: "2027-01-20" };
    const r = buildInsights(entries, s, NOW, 14);
    expect(r.pregnancy).toEqual({ week: 32, day: 1 });
    expect(r.weeks).toEqual([
      { label: "Week 32", week: 32, startKey: "2026-11-25", endKey: "2026-11-26", avgPerDay: 20, days: 1 },
      { label: "Week 31", week: 31, startKey: "2026-11-18", endKey: "2026-11-24", avgPerDay: 20, days: 7 },
      { label: "Week 30", week: 30, startKey: "2026-11-13", endKey: "2026-11-17", avgPerDay: 20, days: 5 },
    ]);
  });

  it("averages only complete days with data", () => {
    const sparse = entries.filter((e) => slotDayKey({ start: e.slotStart, end: e.slotEnd, isSleep: e.isSleep }, IST.timezone) !== "2026-11-24");
    const r = buildInsights(sparse, IST, NOW, 7);
    expect(r.weeks[0]).toMatchObject({ label: "23 Nov", days: 2, avgPerDay: 20 });
  });
});

describe("pregnancyAge", () => {
  it("computes week and day, null outside 0..44 weeks", () => {
    expect(pregnancyAge(null, "2026-11-26")).toBeNull();
    expect(pregnancyAge("2026-11-26", "2026-11-26")).toEqual({ week: 40, day: 0 });
    expect(pregnancyAge("2026-12-03", "2026-11-26")).toEqual({ week: 39, day: 0 });
    expect(pregnancyAge("2026-12-02", "2026-11-26")).toEqual({ week: 39, day: 1 });
    expect(pregnancyAge("2027-09-02", "2026-11-26")).toEqual({ week: 0, day: 0 }); // 280 days ahead
    expect(pregnancyAge("2027-09-03", "2026-11-26")).toBeNull(); // negative age
    expect(pregnancyAge("2026-10-01", "2026-11-26")).toBeNull(); // 48 weeks
    expect(pregnancyAge("2026-10-30", "2026-11-26")).toEqual({ week: 43, day: 6 }); // 307 days
    expect(pregnancyAge("2026-10-23", "2026-11-26")).toEqual({ week: 44, day: 6 }); // 314 days: last allowed
    expect(pregnancyAge("2026-10-22", "2026-11-26")).toBeNull(); // 315 days = 45 weeks
    expect(pregnancyAge("2026-09-23", "2026-11-26")).toBeNull(); // 44w+ -> 49 weeks
    expect(pregnancyAge("2026-11-02", "2026-11-26")).toEqual({ week: 43, day: 3 });
  });

  it("uses today in the settings timezone", () => {
    // 20:00Z on 25 Nov is already 26 Nov 01:30 in Kolkata.
    const r = buildInsights([], { ...IST, dueDate: "2026-11-26" }, "2026-11-25T20:00:00.000Z", 7);
    expect(r.pregnancy).toEqual({ week: 40, day: 0 });
  });
});

describe("buildInsights: DST (America/New_York)", () => {
  it("night slots across DST changes count their real length", () => {
    // Fall back on Sun 1 Nov 2026: night Sat 23:30 EDT – Sun 07:30 EST = 9h.
    const fall: Slot = { start: "2026-11-01T03:30:00.000Z", end: "2026-11-01T12:30:00.000Z", isSleep: true };
    expect(daySlots("2026-11-01", NY).find((x) => x.isSleep)).toEqual(fall);
    const r = buildInsights([entry(fall, { k: 3 })], NY, "2026-11-01T17:00:00.000Z", 7);
    expect(r.today).toMatchObject({ key: "2026-11-01", night: 3, loggedHours: 9 });

    // Spring forward on Sun 8 Mar 2026: night Sat 23:30 EST – Sun 07:30 EDT = 7h.
    const spring: Slot = { start: "2026-03-08T04:30:00.000Z", end: "2026-03-08T11:30:00.000Z", isSleep: true };
    const s = { ...NY, trackingStart: "2026-03-01T00:00:00.000Z" };
    const r2 = buildInsights([entry(spring, "skip")], s, "2026-03-08T16:00:00.000Z", 7);
    expect(r2.today).toMatchObject({ key: "2026-03-08", night: null, skippedHours: 7 });
  });

  it("usualByNow uses the same local time of day on both sides of the change", () => {
    // Now: Tue 3 Nov 2026 12:00 EST (17:00Z). Previous days: night 0, each awake slot 3.
    // Ended by 12:00 local: 07:30, 08:30, 09:30, 10:30 -> 12 per day. A naive "minus 24h"
    // cutoff would be 11:00 or 13:00 local on the EDT days and give 9 or 15.
    const now = "2026-11-03T17:00:00.000Z";
    const entries = fill(NY, "2026-10-26T00:00:00.000Z", "2026-11-03T12:30:00.000Z", (slot) =>
      slot.isSleep ? { k: 0 } : { k: 3 },
    );
    const r = buildInsights(entries, NY, now, 28);
    expect(r.today.usualDays).toBe(7);
    expect(r.today.usualByNow).toBe(12);
    // Grid rows on EDT days still put the 07:30 slot at hour 7.
    const oct30 = r.grid.find((g) => g.key === "2026-10-30")!;
    expect(oct30.cells[7]).toBe(3);
    expect(oct30.cells[23]).toBe(null); // sleep window
    expect(oct30.cells[22]).toBe(3);
    // 30 Oct is a Friday: calendar week of Mon 26 Oct.
    expect(r.weeks.slice(0, 2).map((w) => [w.label, w.startKey, w.endKey])).toEqual([
      ["2 Nov", "2026-11-02", "2026-11-03"],
      ["26 Oct", "2026-10-26", "2026-11-01"],
    ]);
  });
});

describe("validate: dueDate", () => {
  const now = new Date(NOW);
  it("accepts omitted, null and in-range dates", () => {
    const base = { sleepStart: "23:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" };
    expect(parseSettings(base, now)).toEqual({ ok: true, value: base });
    expect(parseSettings({ ...base, dueDate: null }, now)).toEqual({ ok: true, value: { ...base, dueDate: null } });
    expect(parseSettings({ ...base, dueDate: "2027-01-20" }, now)).toEqual({
      ok: true,
      value: { ...base, dueDate: "2027-01-20" },
    });
  });
  it("rejects malformed, impossible and out-of-range dates", () => {
    expect(parseDueDate("2027-02-30", "Asia/Kolkata", now).ok).toBe(false);
    expect(parseDueDate("2027-1-20", "Asia/Kolkata", now).ok).toBe(false);
    expect(parseDueDate(20270120, "Asia/Kolkata", now).ok).toBe(false);
    expect(parseDueDate("", "Asia/Kolkata", now).ok).toBe(false);
    expect(parseDueDate("2026-10-27", "Asia/Kolkata", now).ok).toBe(true); // -30 days
    expect(parseDueDate("2026-10-26", "Asia/Kolkata", now).ok).toBe(false); // -31
    expect(parseDueDate("2027-09-22", "Asia/Kolkata", now).ok).toBe(true); // +300
    expect(parseDueDate("2027-09-23", "Asia/Kolkata", now).ok).toBe(false); // +301
  });
});
