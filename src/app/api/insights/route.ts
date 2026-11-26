import { getSettings, listEntries, publicSettings } from "@/lib/db";
import { badRequest, handle, json } from "@/lib/http";
import { buildInsights, HISTORY_DAYS, MAX_DAYS, MIN_DAYS, DEFAULT_DAYS } from "@/lib/insights";
import type { InsightsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 86_400_000;

export const GET = handle(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("days");
  let days = DEFAULT_DAYS;
  if (raw !== null && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
      return badRequest(`"days" must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`);
    }
    days = n;
  }
  const now = new Date();
  const settings = await getSettings();
  // Today plus max(days, 8) - 1 previous local days are needed (usualByNow looks back 7 days);
  // 2 extra days cover the night slot that starts the evening before the first day and any
  // UTC/local offset. Slots never exceed ~25h, so slot_start >= from is enough.
  const span = Math.max(days, HISTORY_DAYS + 1) + 2;
  const entries = await listEntries(new Date(now.getTime() - span * DAY));
  return json<InsightsResponse>(buildInsights(entries, publicSettings(settings), now, days));
});
