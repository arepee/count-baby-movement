import { handle, json } from "@/lib/http";
import { sendToAll } from "@/lib/push";
import type { PushTestResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async () => {
  const { sent } = await sendToAll({
    title: "Baby Movement",
    body: "Test notification — reminders are working",
    url: "/",
    tag: "bm-test",
  });
  return json<PushTestResponse>({ sent });
});
