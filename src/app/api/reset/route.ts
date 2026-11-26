import { publicSettings, resetAllData } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import type { SettingsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESET_PHRASE = "RESET";

/**
 * Erase every entry and tap and restart tracking from now. The body must be
 * {confirm: "RESET"} so a stray request can't wipe the data.
 */
export const POST = handle(async (req: Request) => {
  const body = (await readJson(req)) as { confirm?: unknown } | null;
  if (!body || body.confirm !== RESET_PHRASE) return badRequest('Send {"confirm":"RESET"} to erase all data');
  return json<SettingsResponse>({ settings: publicSettings(await resetAllData()) });
});
