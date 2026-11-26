import type { Entry } from "@/client/types";

export default function EntryCounts({ entry }: { entry: Entry }) {
  if (entry.skipped) return <span className="tag">skipped</span>;
  return (
    <span className="entry-counts">
      K <b>{entry.kicks}</b> · R <b>{entry.rolls}</b> · O <b>{entry.other}</b>
    </span>
  );
}
