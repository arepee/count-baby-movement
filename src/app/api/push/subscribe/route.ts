import { upsertSubscription } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import { parseSubscription } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const r = parseSubscription(await readJson(req));
  if (!r.ok) return badRequest(r.error);
  await upsertSubscription(r.value);
  return json({ ok: true });
});
