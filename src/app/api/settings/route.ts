import { getSettings, publicSettings, updateSettings } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import type { SettingsResponse } from "@/lib/types";
import { parseSettings } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async () => json<SettingsResponse>({ settings: publicSettings(await getSettings()) }));

export const PUT = handle(async (req: Request) => {
  const r = parseSettings(await readJson(req));
  if (!r.ok) return badRequest(r.error);
  return json<SettingsResponse>({ settings: publicSettings(await updateSettings(r.value)) });
});
