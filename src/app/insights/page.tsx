"use client";

import Link from "next/link";
import { formatPregnancy, keyShort, round1 } from "@/client/insights";
import type { InsightsResponse } from "@/client/types";
import { useInsights } from "@/client/useInsights";
import ActivityGrid from "@/components/ActivityGrid";

export default function InsightsPage() {
  const { data, error } = useInsights(28);

  return (
    <>
      <div className="day-head">
        <h1>Insights</h1>
        {data?.pregnancy && (
          <span className="preg-week">{formatPregnancy(data.pregnancy)}</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          {!data.pregnancy && !data.settings.dueDate && (
            <p className="muted small">
              Add your due date in <Link href="/settings">Settings</Link> to see
              the pregnancy week.
            </p>
          )}
          <TodayCard data={data} />
          <ActiveHoursCard data={data} />
          <WeeklyCard data={data} />
          <Link className="btn block" href="/insights/summary">
            Doctor summary
          </Link>
        </>
      )}
    </>
  );
}

function hours(n: number): string {
  return `${round1(n)} h`;
}

function TodayCard({ data }: { data: InsightsResponse }) {
  const t = data.today;
  return (
    <section className="card" aria-labelledby="today-h">
      <div className="card-head">
        <h2 id="today-h">Today vs usual</h2>
        <span className="muted small">so far</span>
      </div>
      <div className="today-total">
        <span className="num tabular">{t.total}</span>
        <span className="muted">movement{t.total === 1 ? "" : "s"} today</span>
      </div>
      <div className="totals">
        <div>
          <div className="num">{t.kicks}</div>
          <div className="lbl">Kicks</div>
        </div>
        <div>
          <div className="num">{t.rolls}</div>
          <div className="lbl">Rolls</div>
        </div>
        <div>
          <div className="num">{t.other}</div>
          <div className="lbl">Other</div>
        </div>
      </div>
      {t.usualByNow !== null ? (
        <p>
          Usually <b className="tabular">{Math.round(t.usualByNow)}</b> by this
          time
          <span className="muted small">
            {" "}
            (average of {t.usualDays} day{t.usualDays === 1 ? "" : "s"})
          </span>
        </p>
      ) : (
        <p className="muted">
          Not enough history yet to compare — needs at least 3 well-logged days
          in the last week.
        </p>
      )}
      <p className="muted small">
        Logged {hours(t.loggedHours)} today
        {t.skippedHours > 0 ? ` · ${hours(t.skippedHours)} not tracked` : ""}
      </p>
      {t.lowerThanUsual && (
        <p className="notice" role="status">
          Fewer movements than usual so far. If you&apos;re worried, call your
          maternity unit now — don&apos;t wait.
        </p>
      )}
      <p className="muted small">
        There&apos;s no set number of movements. What matters is a change from
        your baby&apos;s usual pattern.
      </p>
    </section>
  );
}

function ActiveHoursCard({ data }: { data: InsightsResponse }) {
  const hasAny = data.grid.some(
    (r) => r.night !== null || r.cells.some((c) => c !== null),
  );
  return (
    <section className="card" aria-labelledby="hours-h">
      <h2 id="hours-h">Active hours</h2>
      {hasAny ? (
        <ActivityGrid
          grid={data.grid}
          hourAvg={data.hourAvg}
          settings={data.settings}
        />
      ) : (
        <p className="muted">No logged hours in the last 7 days yet.</p>
      )}
    </section>
  );
}

function WeeklyCard({ data }: { data: InsightsResponse }) {
  const weeks = data.weeks.filter((w) => w.days > 0);
  const max = Math.max(1, ...weeks.map((w) => w.avgPerDay));
  return (
    <section className="card" aria-labelledby="weekly-h">
      <h2 id="weekly-h">Weekly</h2>
      {weeks.length === 0 ? (
        <p className="muted">
          Weekly averages appear once you&apos;ve logged a few days.
        </p>
      ) : (
        <ul className="list">
          {weeks.map((w) => (
            <li key={w.startKey} className="week-row">
              <span
                className="week-label"
                title={`${keyShort(w.startKey)} – ${keyShort(w.endKey)}`}
              >
                {w.label}
              </span>
              <span className="week-bar" aria-hidden="true">
                <span style={{ width: `${(w.avgPerDay / max) * 100}%` }} />
              </span>
              <span className="week-val tabular">
                {Math.round(w.avgPerDay)}
                <span className="muted small">/day</span>
              </span>
              <span className="sr-only">
                {` per day, from ${w.days} logged day${w.days === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Average movements per fully logged day (today not included).</p>
    </section>
  );
}
