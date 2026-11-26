import { getSettings, insertTap } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import { loadLive } from "@/lib/state";
import type { TapResponse } from "@/lib/types";
import { parseTap } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Record one movement now (server time). Allowed any time, awake or night. */
export const POST = handle(async (req: Request) => {
  const r = parseTap(await readJson(req));
  if (!r.ok) return badRequest(r.error);
  const now = new Date();
  const [tap, settings] = await Promise.all([insertTap(r.value.kind, now), getSettings()]);
  return json<TapResponse>({ tap, live: await loadLive(now, settings) });
});
