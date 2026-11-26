import { describe, expect, it } from "vitest";
import { decideReminder, type ReminderInput } from "../reminders";
import { pendingSlots, type SlotSettings } from "../slots";

const IST: SlotSettings = { sleepStart: "23:30", sleepEnd: "07:30", timezone: "Asia/Kolkata" };
const at = (s: string) => new Date(s);
function input(now: string, trackingStart: string, over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    now: at(now),
    settings: IST,
    pending: pendingSlots(now, { ...IST, trackingStart }, new Set()),
    lastNotifiedSlot: null,
    lastNotifiedAt: null,
    ...over,
  };
}

describe("decideReminder", () => {
  it("does nothing while sleeping", () => {
    expect(decideReminder(input("2026-11-25T20:00:00Z", "2026-11-25T10:00:00Z"))).toEqual({ notify: false, reason: "sleeping" });
  });

  it("does nothing with no pending slots", () => {
    expect(decideReminder(input("2026-11-26T09:10:00Z", "2026-11-26T09:00:00Z")).reason).toBe("nothing-pending");
  });

  it("notifies about a single new slot", () => {
    const d = decideReminder(input("2026-11-26T10:05:00Z", "2026-11-26T09:10:00Z")); // 3:35 PM IST
    expect(d).toEqual({
      notify: true,
      reason: "new-slot",
      slotStart: "2026-11-26T09:00:00.000Z",
      payload: { title: "Baby Movement", body: "Log baby movement for 2:30–3:30 PM", url: "/", tag: "bm-reminder" },
    });
  });

  it("summarises several pending slots", () => {
    const d = decideReminder(input("2026-11-26T10:05:00Z", "2026-11-26T07:10:00Z"));
    expect(d.notify && d.payload.body).toBe("3 hours to log, starting Thu 12:30 PM");
  });

  it("good morning for the night slot", () => {
    const d = decideReminder(input("2026-11-26T02:10:00Z", "2026-11-25T20:00:00Z"));
    expect(d.notify && d.payload.body).toBe("Good morning — log movement for the night");
    const d2 = decideReminder(input("2026-11-26T02:10:00Z", "2026-11-25T17:10:00Z"));
    expect(d2.notify && d2.payload.body).toBe("Good morning — 2 hours to log, starting Wed 10:30 PM");
  });

  it("re-reminds after 55 minutes for the same latest slot, not before", () => {
    const base = input("2026-11-26T10:05:00Z", "2026-11-26T09:10:00Z", { lastNotifiedSlot: "2026-11-26T09:00:00+00:00" });
    expect(decideReminder({ ...base, lastNotifiedAt: "2026-11-26T09:35:00Z" })).toEqual({ notify: false, reason: "recently-notified" });
    const d = decideReminder({ ...base, lastNotifiedAt: "2026-11-26T09:10:00Z" });
    expect(d.reason).toBe("re-remind");
    expect(d.notify && d.payload.body).toBe("Still waiting: 1 hour to log");
  });

  it("re-reminds only when the in-progress slot isn't about to end", () => {
    // pending 2:30-3:30 PM IST, notified at 3:31 PM; current slot 4:30-5:30 PM IST (11:00-12:00Z)
    const mk = (now: string) =>
      decideReminder(
        input(now, "2026-11-26T09:10:00Z", {
          pending: [{ start: "2026-11-26T09:00:00.000Z", end: "2026-11-26T10:00:00.000Z", isSleep: false }],
          lastNotifiedSlot: "2026-11-26T09:00:00Z",
          lastNotifiedAt: "2026-11-26T10:01:00Z",
        }),
      );
    expect(mk("2026-11-26T11:44:00Z").reason).toBe("re-remind"); // ends in 16 min
    expect(mk("2026-11-26T11:45:00Z")).toEqual({ notify: false, reason: "new-slot-soon" }); // ends in 15 min
    expect(mk("2026-11-26T11:55:00Z")).toEqual({ notify: false, reason: "new-slot-soon" });
    expect(mk("2026-11-26T10:30:00Z").reason).toBe("recently-notified"); // 29 min after the last push
  });

  it("still re-reminds just before the sleep window (no new-slot push follows until morning)", () => {
    // current slot 10:30-11:30 PM IST (17:00-18:00Z), then night
    const d = decideReminder(
      input("2026-11-26T17:50:00Z", "2026-11-26T15:10:00Z", {
        lastNotifiedSlot: "2026-11-26T16:00:00Z",
        lastNotifiedAt: "2026-11-26T16:40:00Z",
      }),
    );
    expect(d.reason).toBe("re-remind");
  });

  it("notifies again when a newer slot becomes pending", () => {
    const d = decideReminder(
      input("2026-11-26T11:05:00Z", "2026-11-26T09:10:00Z", {
        lastNotifiedSlot: "2026-11-26T09:00:00Z",
        lastNotifiedAt: "2026-11-26T10:35:00Z",
      }),
    );
    expect(d.reason).toBe("new-slot");
    expect(d.notify && d.payload.body).toBe("2 hours to log, starting Thu 2:30 PM");
  });
});
