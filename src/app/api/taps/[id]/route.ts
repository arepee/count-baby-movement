import { deleteTap, entryRangesBetween, getSettings, getTap } from "@/lib/db";
import { badRequest, handle, json } from "@/lib/http";
import { slotContaining } from "@/lib/slots";
import { loadLive } from "@/lib/state";
import type { TapDeleteResponse } from "@/lib/types";
import { parseId } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Undo a tap. Refused (409) once the tap's hour has a confirmed entry. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const id = parseId((await ctx.params).id, "tap");
  if (!id.ok) return badRequest(id.error);
  const [tap, settings] = await Promise.all([getTap(id.value), getSettings()]);
  if (!tap) return json({ error: "Tap not found" }, 404);
  // Same rule as coveredStarts(): a slot has an entry when any entry overlaps it.
  const slot = slotContaining(tap.at, settings);
  if ((await entryRangesBetween(slot.start, slot.end)).length > 0) {
    return json({ error: "That hour is already saved" }, 409);
  }
  if (!(await deleteTap(id.value))) return json({ error: "Tap not found" }, 404);
  return json<TapDeleteResponse>({ ok: true, live: await loadLive(new Date(), settings) });
});
