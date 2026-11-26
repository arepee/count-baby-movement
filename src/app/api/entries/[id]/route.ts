import { deleteEntry, updateEntry } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import type { EntryResponse } from "@/lib/types";
import { parseCounts, parseId } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = parseId((await ctx.params).id);
  if (!id.ok) return badRequest(id.error);
  const counts = parseCounts(await readJson(req));
  if (!counts.ok) return badRequest(counts.error);
  const entry = await updateEntry(id.value, counts.value);
  return entry ? json<EntryResponse>({ entry }) : json({ error: "Entry not found" }, 404);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const id = parseId((await ctx.params).id);
  if (!id.ok) return badRequest(id.error);
  return (await deleteEntry(id.value)) ? json({ ok: true }) : json({ error: "Entry not found" }, 404);
});
