import { publicSettings, setupTracking } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import type { SettingsResponse } from "@/lib/types";
import { parseSetup } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * First-run setup and "Restart tracking from now": sets the timezone (the device's),
 * tracking_start = now and initialized = true. Existing entries are kept.
 */
export const POST = handle(async (req: Request) => {
  const r = parseSetup(await readJson(req));
  if (!r.ok) return badRequest(r.error);
  return json<SettingsResponse>({ settings: publicSettings(await setupTracking(r.value.timezone)) });
});
