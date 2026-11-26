import { describe, expect, it } from "vitest";
import { entriesToCsv } from "../csv";
import { lockMessage, lockoutMinutes, lockRemainingMinutes } from "../lockout";
import { safeEqual, signSession, verifySession } from "../session";
import { parseCounts, parseId, parseSettings, parseSubscription } from "../validate";

describe("session", () => {
  it("signs and verifies", async () => {
    const t = await signSession("s3cret", 1_700_000_000_000);
    expect(t).toMatch(/^1700000000000\.[0-9a-f]{64}$/);
    expect(await verifySession(t, "s3cret", 1_700_000_000_000 + 1000)).toBe(true);
    expect(await verifySession(t, "other", 1_700_000_000_000)).toBe(false);
    expect(await verifySession(t.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "s3cret", 1_700_000_000_000)).toBe(false);
    expect(await verifySession(t, "s3cret", 1_700_000_000_000 + 401 * 86_400_000)).toBe(false);
    expect(await verifySession(undefined, "s3cret")).toBe(false);
    expect(await verifySession(t, undefined)).toBe(false);
  });
  it("safeEqual", () => {
    expect(safeEqual("1234", "1234")).toBe(true);
    expect(safeEqual("1234", "1235")).toBe(false);
    expect(safeEqual("123", "1234")).toBe(false);
  });
});

describe("validate", () => {
  it("counts", () => {
    expect(parseCounts({ kicks: 1, rolls: 0, other: 999 })).toEqual({ ok: true, value: { kicks: 1, rolls: 0, other: 999, skipped: false } });
    expect(parseCounts({ skipped: true, kicks: 5 })).toEqual({ ok: true, value: { kicks: 0, rolls: 0, other: 0, skipped: true } });
    expect(parseCounts({ kicks: 1, rolls: 0 }).ok).toBe(false);
    expect(parseCounts({ kicks: -1, rolls: 0, other: 0 }).ok).toBe(false);
    expect(parseCounts({ kicks: 1.5, rolls: 0, other: 0 }).ok).toBe(false);
    expect(parseCounts({ kicks: 1000, rolls: 0, other: 0 }).ok).toBe(false);
    expect(parseCounts({ kicks: "1", rolls: 0, other: 0 }).ok).toBe(false);
    expect(parseCounts({ kicks: 1, rolls: 0, other: 0, skipped: "yes" }).ok).toBe(false);
    expect(parseCounts(null).ok).toBe(false);
  });
  it("settings", () => {
    expect(parseSettings({ sleepStart: "23:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" }).ok).toBe(true);
    expect(parseSettings({ sleepStart: "24:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" }).ok).toBe(false);
    expect(parseSettings({ sleepStart: "23:30", sleepEnd: "07:30", timezone: "Nope/Nope" }).ok).toBe(false);
  });
  it("subscription and id", () => {
    expect(parseSubscription({ endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } })).toEqual({
      ok: true,
      value: { endpoint: "https://push.example/x", p256dh: "a", auth: "b" },
    });
    expect(parseSubscription({ endpoint: "https://push.example/x" }).ok).toBe(false);
    expect(parseId("12")).toEqual({ ok: true, value: 12 });
    expect(parseId("1e3").ok).toBe(false);
    expect(parseId("0").ok).toBe(false);
  });
});

describe("csv", () => {
  it("renders entries with local times", () => {
    const csv = entriesToCsv(
      [{ id: 1, slotStart: "2026-11-26T09:00:00.000Z", slotEnd: "2026-11-26T10:00:00.000Z", isSleep: false, kicks: 3, rolls: 1, other: 0, skipped: false, createdAt: "x", updatedAt: "2026-11-26T10:01:00.000Z" }],
      "Asia/Kolkata",
    );
    expect(csv.split("\r\n")[1]).toBe("2026-11-26,2:30 PM,3:30 PM,hour,3,1,0,false,2026-11-26T09:00:00.000Z,2026-11-26T10:00:00.000Z,2026-11-26T10:01:00.000Z");
  });
  it("dates a night entry by the day it ends (wake day)", () => {
    const csv = entriesToCsv(
      [{ id: 2, slotStart: "2026-11-25T18:00:00.000Z", slotEnd: "2026-11-26T02:00:00.000Z", isSleep: true, kicks: 4, rolls: 0, other: 1, skipped: false, createdAt: "x", updatedAt: "2026-11-26T02:05:00.000Z" }],
      "Asia/Kolkata",
    );
    expect(csv.split("\r\n")[1]).toBe("2026-11-26,11:30 PM,7:30 AM,night,4,0,1,false,2026-11-25T18:00:00.000Z,2026-11-26T02:00:00.000Z,2026-11-26T02:05:00.000Z");
  });
});

describe("lockout", () => {
  it("locks after 5 failures for 5 min, doubling up to 60", () => {
    expect([1, 4, 5, 6, 7, 8, 9, 20, 1000].map(lockoutMinutes)).toEqual([0, 0, 5, 10, 20, 40, 60, 60, 60]);
  });
  it("remaining minutes round up and expire", () => {
    const now = Date.parse("2026-11-26T10:00:00Z");
    expect(lockRemainingMinutes(null, now)).toBe(0);
    expect(lockRemainingMinutes("2026-11-26T09:59:00Z", now)).toBe(0);
    expect(lockRemainingMinutes("2026-11-26T10:00:01Z", now)).toBe(1);
    expect(lockRemainingMinutes("2026-11-26T10:04:30Z", now)).toBe(5);
    expect(lockMessage(5)).toBe("Too many attempts. Try again in 5 min.");
  });
});
