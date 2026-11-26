import { describe, expect, it } from "vitest";
import { decideReminder } from "../reminders";
import { coveredStarts, pendingSlots, slotContaining, type SlotSettings } from "../slots";
import {
  buildTapState,
  confirmTapsBody,
  countTaps,
  countTapsBySlot,
  formatCounts,
  isTapKind,
  localMidnight,
  MAX_TODAY_TAPS,
} from "../taps";
import type { Slot, Tap, TapKind } from "../types";

// IST = UTC+5:30, sleep 23:30–07:30. Awake slot 2:30–3:30 PM IST on Thu 26 Nov = 09:00–10:00Z.
const IST: SlotSettings = { sleepStart: "23:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" };
const AWAKE: Slot = { start: "2026-11-26T09:00:00.000Z", end: "2026-11-26T10:00:00.000Z", isSleep: false };
// Night Wed 25 23:30 IST – Thu 26 07:30 IST = 18:00Z – 02:00Z.
const NIGHT: Slot = { start: "2026-11-25T18:00:00.000Z", end: "2026-11-26T02:00:00.000Z", isSleep: true };

let nextId = 1;
const tap = (at: string, kind: TapKind = "kick"): Tap => ({ id: nextId++, at: new Date(at).toISOString(), kind });

describe("isTapKind / countTaps / formatCounts", () => {
  it("validates kinds", () => {
    expect(["kick", "roll", "other"].every(isTapKind)).toBe(true);
    expect(isTapKind("kicks")).toBe(false);
    expect(isTapKind(undefined)).toBe(false);
  });
  it("counts by kind", () => {
    expect(countTaps([tap(AWAKE.start), tap(AWAKE.start, "roll"), tap(AWAKE.start), tap(AWAKE.start, "other")])).toEqual({
      kicks: 2,
      rolls: 1,
      other: 1,
    });
  });
  it("formats counts, omitting zero kinds", () => {
    expect(formatCounts({ kicks: 3, rolls: 1, other: 0 })).toBe("3 kicks, 1 roll");
    expect(formatCounts({ kicks: 1, rolls: 0, other: 2 })).toBe("1 kick, 2 other");
    expect(formatCounts({ kicks: 0, rolls: 0, other: 0 })).toBe("");
  });
});

describe("countTapsBySlot", () => {
  it("counts taps in an awake slot", () => {
    const r = countTapsBySlot([tap("2026-11-26T09:10:00Z"), tap("2026-11-26T09:50:00Z", "roll")], [AWAKE]);
    expect(r).toEqual({ [AWAKE.start]: { kicks: 1, rolls: 1, other: 0 } });
  });

  it("counts taps across the whole night slot", () => {
    const taps = [tap("2026-11-25T18:00:00Z"), tap("2026-11-25T21:00:00Z"), tap("2026-11-26T01:59:59Z", "other")];
    expect(countTapsBySlot(taps, [NIGHT])).toEqual({ [NIGHT.start]: { kicks: 2, rolls: 0, other: 1 } });
  });

  it("uses [start, end): a tap exactly at end belongs to the next slot", () => {
    const next: Slot = { start: AWAKE.end, end: "2026-11-26T11:00:00.000Z", isSleep: false };
    const taps = [tap(AWAKE.start), tap("2026-11-26T08:59:59.999Z"), tap(AWAKE.end, "roll")];
    expect(countTapsBySlot(taps, [AWAKE, next])).toEqual({
      [AWAKE.start]: { kicks: 1, rolls: 0, other: 0 },
      [next.start]: { kicks: 0, rolls: 1, other: 0 },
    });
  });

  it("leaves out slots with an entry and slots with no taps", () => {
    const empty: Slot = { start: AWAKE.end, end: "2026-11-26T11:00:00.000Z", isSleep: false };
    const covered = coveredStarts([{ slotStart: AWAKE.start, slotEnd: AWAKE.end }], IST);
    expect(countTapsBySlot([tap("2026-11-26T09:30:00Z")], [AWAKE, empty], covered)).toEqual({});
  });

  it("ignores taps before tracking start", () => {
    const taps = [tap("2026-11-26T09:05:00Z"), tap("2026-11-26T09:20:00Z")];
    expect(countTapsBySlot(taps, [AWAKE], new Set(), "2026-11-26T09:10:00Z")).toEqual({
      [AWAKE.start]: { kicks: 1, rolls: 0, other: 0 },
    });
  });
});

describe("localMidnight", () => {
  it("returns local midnight as UTC", () => {
    expect(new Date(localMidnight("2026-11-26T10:00:00Z", "Asia/Kolkata")).toISOString()).toBe("2026-11-25T18:30:00.000Z");
    // 01:00 IST on the 27th is still the 27th locally.
    expect(new Date(localMidnight("2026-11-26T19:30:00Z", "Asia/Kolkata")).toISOString()).toBe("2026-11-26T18:30:00.000Z");
  });
});

describe("buildTapState", () => {
  const settings = { ...IST, trackingStart: "2026-11-26T07:10:00Z", initialized: true };
  const now = new Date("2026-11-26T10:20:00Z"); // 3:50 PM IST; current slot 10:00–11:00Z
  const current = slotContaining(now, IST);

  it("splits taps into live, prefill and todayTaps", () => {
    // Pending: 07:00–08:00Z (has an entry -> not pending), 08:00–09:00Z, 09:00–10:00Z.
    const entries = [{ slotStart: "2026-11-26T07:00:00.000Z", slotEnd: "2026-11-26T08:00:00.000Z" }];
    const covered = coveredStarts(entries, IST);
    const pending = pendingSlots(now, settings, covered);
    expect(pending.map((p) => p.start)).toEqual(["2026-11-26T08:00:00.000Z", "2026-11-26T09:00:00.000Z"]);
    const taps = [
      tap("2026-11-25T20:00:00Z"), // 01:30 IST today, before tracking start: shown in todayTaps, never prefills
      tap("2026-11-26T07:30:00Z"), // slot with an entry: hidden everywhere
      tap("2026-11-26T09:15:00Z"),
      tap("2026-11-26T09:45:00Z", "roll"),
      tap("2026-11-26T10:05:00Z", "other"),
      tap("2026-11-26T10:06:00Z"),
    ];
    const r = buildTapState({ now, settings, current, pending, taps, covered });
    expect(r.live).toEqual({ kicks: 1, rolls: 0, other: 1 });
    expect(r.prefill).toEqual({ "2026-11-26T09:00:00.000Z": { kicks: 1, rolls: 1, other: 0 } });
    expect(r.todayTaps.map((t) => t.at)).toEqual([
      "2026-11-26T10:06:00.000Z",
      "2026-11-26T10:05:00.000Z",
      "2026-11-26T09:45:00.000Z",
      "2026-11-26T09:15:00.000Z",
      "2026-11-25T20:00:00.000Z",
    ]);
  });

  it("returns zero live counts and caps todayTaps", () => {
    const taps = Array.from({ length: MAX_TODAY_TAPS + 5 }, (_, i) => tap(new Date(Date.parse("2026-11-26T08:00:00Z") + i * 1000).toISOString()));
    const r = buildTapState({ now, settings, current, pending: [], taps, covered: new Set() });
    expect(r.live).toEqual({ kicks: 0, rolls: 0, other: 0 });
    expect(r.prefill).toEqual({});
    expect(r.todayTaps).toHaveLength(MAX_TODAY_TAPS);
    expect(r.todayTaps[0].at).toBe(taps[taps.length - 1].at);
  });
});

describe("confirm reminder text", () => {
  it("formats awake and night slots", () => {
    expect(confirmTapsBody(AWAKE, { kicks: 3, rolls: 1, other: 0 }, "Asia/Kolkata")).toBe("Confirm 3 kicks, 1 roll for 2:30–3:30 PM");
    expect(confirmTapsBody(NIGHT, { kicks: 5, rolls: 0, other: 0 }, "Asia/Kolkata")).toBe("Confirm the night: 5 kicks");
    expect(confirmTapsBody(AWAKE, undefined, "Asia/Kolkata")).toBeNull();
    expect(confirmTapsBody(AWAKE, { kicks: 0, rolls: 0, other: 0 }, "Asia/Kolkata")).toBeNull();
  });

  const base = (now: string, trackingStart: string) => ({
    now: new Date(now),
    settings: IST,
    pending: pendingSlots(now, { ...IST, trackingStart }, new Set()),
    lastNotifiedSlot: null,
    lastNotifiedAt: null,
  });

  it("uses the confirm text for a single new slot with taps", () => {
    const d = decideReminder({ ...base("2026-11-26T10:05:00Z", "2026-11-26T09:10:00Z"), prefill: { [AWAKE.start]: { kicks: 3, rolls: 1, other: 0 } } });
    expect(d.notify && d.payload.body).toBe("Confirm 3 kicks, 1 roll for 2:30–3:30 PM");
  });

  it("uses the confirm text for the night", () => {
    const d = decideReminder({ ...base("2026-11-26T02:05:00Z", "2026-11-25T18:10:00Z"), prefill: { [NIGHT.start]: { kicks: 5, rolls: 0, other: 0 } } });
    expect(d.notify && d.payload.body).toBe("Confirm the night: 5 kicks");
  });

  it("keeps the multi-pending text", () => {
    const d = decideReminder({ ...base("2026-11-26T10:05:00Z", "2026-11-26T07:10:00Z"), prefill: { [AWAKE.start]: { kicks: 3, rolls: 0, other: 0 } } });
    expect(d.notify && d.payload.body).toBe("3 hours to log, starting Thu 12:30 PM");
  });
});
