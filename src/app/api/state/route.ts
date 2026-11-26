import { listEntries, publicSettings } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { loadState } from "@/lib/state";
import type { StateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async () => {
  const now = new Date();
  const [s, recent] = await Promise.all([loadState(now), listEntries(new Date(now.getTime() - 7 * 86_400_000))]);
  return json<StateResponse>({
    now: now.toISOString(),
    settings: publicSettings(s.settings),
    pending: s.pending,
    current: s.current,
    recent,
    live: s.live,
    lastTap: s.lastTap,
    todayTaps: s.todayTaps,
    prefill: s.prefill,
  });
});
