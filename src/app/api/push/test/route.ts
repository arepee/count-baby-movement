import { handle, json } from "@/lib/http";
import { PushNotConfiguredError, sendToAll } from "@/lib/push";
import type { PushTestResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async () => {
  try {
    const r = await sendToAll({
      title: "Baby Movement",
      body: "Test notification — reminders are working",
      url: "/",
      tag: "bm-test",
    });
    return json<PushTestResponse>(r);
  } catch (err) {
    if (err instanceof PushNotConfiguredError) return json({ error: err.message }, 503);
    throw err;
  }
});
