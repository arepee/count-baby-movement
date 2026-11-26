import {
  awakeStartHours,
  keyShort,
  keyWeekday,
  round1,
} from "@/client/insights";
import type { InsightsResponse, Settings } from "@/client/types";

type Props = {
  grid: InsightsResponse["grid"];
  hourAvg: InsightsResponse["hourAvg"];
  settings: Pick<Settings, "sleepStart" | "sleepEnd">;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const TICKS = ["12a", "6a", "12p", "6p"];

function level(v: number | null, max: number): string {
  if (v === null) return "none";
  if (v <= 0 || max <= 0) return "l0";
  return `l${Math.min(4, Math.max(1, Math.ceil((v / max) * 4)))}`;
}

function clock(h: number, minute: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ap}`;
}

function fmtCount(v: number | null): string {
  return v === null
    ? "not logged"
    : `${round1(v)} movement${v === 1 ? "" : "s"}`;
}

/**
 * 7 days × 24 hourly columns (by awake-slot start hour) + night column, with an
 * average row. Tiny cells so it fits a 320px phone without horizontal scroll.
 */
export default function ActivityGrid({ grid, hourAvg, settings }: Props) {
  const awake = awakeStartHours(settings);
  const minute = Number(settings.sleepEnd.split(":")[1] ?? 0) || 0;
  const cellMax = Math.max(
    0,
    ...grid.flatMap((r) => r.cells.filter((c): c is number => c !== null)),
    ...hourAvg.filter((c): c is number => c !== null),
  );
  const nights = grid
    .map((r) => r.night)
    .filter((n): n is number => n !== null);
  const nightMax = Math.max(0, ...nights);
  const nightAvg = nights.length
    ? nights.reduce((a, b) => a + b, 0) / nights.length
    : null;

  const cellClass = (h: number, v: number | null) => {
    const cls = ["hg-cell", level(v, cellMax)];
    if (!awake.has(h)) cls.push("off");
    if (h > 0 && h % 6 === 0) cls.push("sep");
    return cls.join(" ");
  };

  return (
    <div
      className="hgrid"
      role="table"
      aria-label="Movements per hour, last 7 days"
    >
      <div className="hg-row hg-ticks" role="row" aria-hidden="true">
        <span className="hg-label" />
        {TICKS.map((t, i) => (
          <span key={t} className={i > 0 ? "hg-tick sep" : "hg-tick"}>
            {t}
          </span>
        ))}
        <span className="hg-night-head">Night</span>
      </div>
      {grid.map((r) => (
        <div key={r.key} className="hg-row" role="row">
          <span className="hg-label" role="rowheader" title={keyShort(r.key)}>
            {keyWeekday(r.key)}
          </span>
          {HOURS.map((h) => {
            const v = r.cells[h] ?? null;
            const label = awake.has(h)
              ? `${keyShort(r.key)}, ${clock(h, minute)}: ${fmtCount(v)}`
              : `${keyShort(r.key)}, ${clock(h, minute)}: asleep`;
            return (
              <span
                key={h}
                className={cellClass(h, v)}
                role="cell"
                title={label}
                aria-label={label}
              />
            );
          })}
          <span
            className={`hg-night ${level(r.night, nightMax)}`}
            role="cell"
            title={`${keyShort(r.key)}, night: ${fmtCount(r.night)}`}
            aria-label={`${keyShort(r.key)}, night: ${fmtCount(r.night)}`}
          >
            {r.night ?? "–"}
          </span>
        </div>
      ))}
      <div className="hg-row hg-avg" role="row">
        <span
          className="hg-label"
          role="rowheader"
          title="Average per hour over these days"
        >
          Avg
        </span>
        {HOURS.map((h) => {
          const v = hourAvg[h] ?? null;
          const label = `Average at ${clock(h, minute)}: ${v === null ? "no data" : round1(v)}`;
          return (
            <span
              key={h}
              className={cellClass(h, v)}
              role="cell"
              title={label}
              aria-label={label}
            />
          );
        })}
        <span
          className={`hg-night ${level(nightAvg, nightMax)}`}
          role="cell"
          title={`Average night: ${nightAvg === null ? "no data" : round1(nightAvg)}`}
          aria-label={`Average night: ${nightAvg === null ? "no data" : round1(nightAvg)}`}
        >
          {nightAvg === null ? "–" : Math.round(nightAvg)}
        </span>
      </div>
      <div className="hg-legend" aria-hidden="true">
        <span>Less</span>
        <i className="hg-sw l0" />
        <i className="hg-sw l1" />
        <i className="hg-sw l2" />
        <i className="hg-sw l3" />
        <i className="hg-sw l4" />
        <span>More</span>
        <i className="hg-sw none" />
        <span>Not logged</span>
      </div>
    </div>
  );
}
