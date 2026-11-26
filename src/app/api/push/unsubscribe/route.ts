import { deleteSubscription } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const endpoint = ((await readJson(req)) as { endpoint?: unknown } | undefined)?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) return badRequest('"endpoint" is required');
  await deleteSubscription(endpoint);
  return json({ ok: true });
});
