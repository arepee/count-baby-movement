import type { CSSProperties } from "react";
import {
  awakeColumns,
  keyShort,
  keyWeekday,
  round1,
  wakeMinute,
} from "@/client/insights";
import type { InsightsResponse, Settings } from "@/client/types";

type Props = {
  grid: InsightsResponse["grid"];
  hourAvg: InsightsResponse["hourAvg"];
  settings: Pick<Settings, "sleepStart" | "sleepEnd">;
};

/** A tick label (and a small visual gap) every this many hour columns. */
const TICK_EVERY = 3;

function level(v: number | null, max: number): string {
  if (v === null) return "none";
  if (v <= 0 || max <= 0) return "l0";
  return `l${Math.min(4, Math.max(1, Math.ceil((v / max) * 4)))}`;
}

function clock(h: number, minute: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ap}`;
}

/** "7a", "12p" */
function tick(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? "a" : "p"}`;
}

function fmtCount(v: number | null): string {
  return v === null
    ? "not logged"
    : `${round1(v)} movement${v === 1 ? "" : "s"}`;
}

/**
 * 7 days × one column per awake hourly slot (from the wake time to sleep start,
 * by slot start hour) + a night column, with an average row. Sleep-window hours
 * aren't shown: the whole night is the last column. Small cells so it fits a 320px
 * phone without horizontal scroll.
 */
export default function ActivityGrid({ grid, hourAvg, settings }: Props) {
  const cols = awakeColumns(settings);
  const minute = wakeMinute(settings);
  const cellMax = Math.max(
    0,
    ...grid.flatMap((r) =>
      cols.map((h) => r.cells[h]).filter((c): c is number => c != null),
    ),
    ...cols.map((h) => hourAvg[h]).filter((c): c is number => c != null),
  );
  const nights = grid
    .map((r) => r.night)
    .filter((n): n is number => n !== null);
  const nightMax = Math.max(0, ...nights);
  const nightAvg = nights.length
    ? nights.reduce((a, b) => a + b, 0) / nights.length
    : null;

  const sep = (i: number) => (i > 0 && i % TICK_EVERY === 0 ? " sep" : "");
  const ticks = cols
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => i % TICK_EVERY === 0);
  const style = { "--hg-cols": cols.length } as CSSProperties;

  return (
    <div
      className="hgrid"
      role="table"
      aria-label="Movements per waking hour and night, last 7 days"
      style={style}
    >
      <div className="hg-row hg-ticks" role="row" aria-hidden="true">
        <span className="hg-label" />
        {ticks.map(({ h, i }) => (
          <span
            key={h}
            className={`hg-tick${sep(i)}`}
            style={{ gridColumn: `${i + 2} / span ${Math.min(TICK_EVERY, cols.length - i)}` }}
          >
            {tick(h)}
          </span>
        ))}
        <span className="hg-night-head" style={{ gridColumn: cols.length + 2 }}>
          Night
        </span>
      </div>
      {grid.map((r) => (
        <div key={r.key} className="hg-row" role="row">
          <span className="hg-label" role="rowheader" title={keyShort(r.key)}>
            {keyWeekday(r.key)}
          </span>
          {cols.map((h, i) => {
            const v = r.cells[h] ?? null;
            const future = v === null && (r.future?.[h] ?? false);
            const label = `${keyShort(r.key)}, ${clock(h, minute)}: ${future ? "not yet" : fmtCount(v)}`;
            return (
              <span
                key={h}
                className={`hg-cell ${future ? "future" : level(v, cellMax)}${sep(i)}`}
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
        {cols.map((h, i) => {
          const v = hourAvg[h] ?? null;
          const label = `Average at ${clock(h, minute)}: ${v === null ? "no data" : round1(v)}`;
          return (
            <span
              key={h}
              className={`hg-cell ${level(v, cellMax)}${sep(i)}`}
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
