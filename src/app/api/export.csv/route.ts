import { getSettings, listEntries } from "@/lib/db";
import { handle } from "@/lib/http";
import { entriesToCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async () => {
  const [settings, entries] = await Promise.all([getSettings(), listEntries()]);
  const csv = entriesToCsv(entries.reverse(), settings.timezone);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="baby-movement-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
