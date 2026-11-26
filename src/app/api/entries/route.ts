import { getSettings, listEntries, upsertEntry } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import { slotContaining } from "@/lib/slots";
import type { EntriesResponse, EntryResponse } from "@/lib/types";
import { parseCounts, parseInstant } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const bounds: (Date | null)[] = [];
  for (const name of ["from", "to"]) {
    const v = params.get(name);
    if (!v) {
      bounds.push(null);
      continue;
    }
    const r = parseInstant(v, name);
    if (!r.ok) return badRequest(r.error);
    bounds.push(r.value);
  }
  return json<EntriesResponse>({ entries: await listEntries(bounds[0], bounds[1]) });
});

export const POST = handle(async (req: Request) => {
  const body = await readJson(req);
  const start = parseInstant((body as { slotStart?: unknown } | undefined)?.slotStart, "slotStart");
  if (!start.ok) return badRequest(start.error);
  const counts = parseCounts(body);
  if (!counts.ok) return badRequest(counts.error);

  const settings = await getSettings();
  const slot = slotContaining(start.value, settings);
  if (new Date(slot.start).getTime() !== start.value.getTime()) {
    return badRequest(`"slotStart" is not a slot boundary (nearest slot starts at ${slot.start})`);
  }
  if (new Date(slot.end).getTime() > Date.now()) return badRequest("This slot hasn't ended yet");
  const first = slotContaining(settings.trackingStart, settings);
  if (new Date(slot.start).getTime() < new Date(first.start).getTime()) {
    return badRequest(`This slot is before tracking started (${first.start})`);
  }
  return json<EntryResponse>({ entry: await upsertEntry(slot, counts.value) });
});
