import { sumTotals } from "@/client/format";
import type { Entry } from "@/client/types";

type Group = { key: string; items: Entry[] };

const MAX_DAYS = 14;

/** Stacked bars of kicks / rolls / other per day, oldest on the left. */
export default function DailyChart({ groups }: { groups: Group[] }) {
  const days = groups
    .slice(0, MAX_DAYS)
    .map((g) => ({ key: g.key, ...sumTotals(g.items) }))
    .reverse();
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.kicks + d.rolls + d.other));

  return (
    <section className="card chart-card" aria-label="Movements per day">
      <div className="chart-legend">
        <span><i className="sw sw-kicks" />Kicks</span>
        <span><i className="sw sw-rolls" />Rolls</span>
        <span><i className="sw sw-other" />Other</span>
      </div>
      <div className="chart" role="list">
        {days.map((d) => {
          const total = d.kicks + d.rolls + d.other;
          const day = Number(d.key.slice(8));
          return (
            <div
              key={d.key}
              className="chart-col"
              role="listitem"
              aria-label={`${d.key}: ${d.kicks} kicks, ${d.rolls} rolls, ${d.other} other`}
            >
              <span className="chart-total">{total}</span>
              <div className="chart-bar" style={{ height: `${(total / max) * 100}%` }}>
                <div className="seg seg-other" style={{ flexGrow: d.other }} />
                <div className="seg seg-rolls" style={{ flexGrow: d.rolls }} />
                <div className="seg seg-kicks" style={{ flexGrow: d.kicks }} />
              </div>
              <span className="chart-label">{day}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
