import { listEntries, publicSettings } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { slotContaining } from "@/lib/slots";
import { loadPending } from "@/lib/state";
import type { StateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async () => {
  const now = new Date();
  const { settings, pending } = await loadPending(now);
  const recent = await listEntries(new Date(now.getTime() - 7 * 86_400_000));
  return json<StateResponse>({
    now: now.toISOString(),
    settings: publicSettings(settings),
    pending,
    current: slotContaining(now, settings),
    recent,
  });
});
