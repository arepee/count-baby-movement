"use client";

import Link from "next/link";
import {
  flagLowDays,
  formatPregnancy,
  keyLong,
  keyShort,
  LOW_MIN_BASELINE_DAYS,
  round1,
} from "@/client/insights";
import { useInsights } from "@/client/useInsights";
import ActivityGrid from "@/components/ActivityGrid";

export default function DoctorSummaryPage() {
  const { data, error } = useInsights(28);

  const days = data
    ? [...data.days].sort((a, b) => (a.key < b.key ? -1 : 1))
    : [];
  const low = data
    ? flagLowDays(data.days, data.today.key)
    : new Map<string, number>();
  const weeks = data ? data.weeks.filter((w) => w.days > 0) : [];
  const generated = data ? keyLong(data.today.key) : "";

  return (
    <div className="summary">
      <div className="no-print btn-row">
        <Link className="btn" href="/insights">
          ← Back
        </Link>
        <button
          type="button"
          className="btn primary"
          onClick={() => window.print()}
          disabled={!data}
        >
          Print
        </button>
      </div>

      <h1>Fetal movement summary</h1>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <dl className="sum-meta">
            <div>
              <dt>Period</dt>
              <dd>
                {days.length
                  ? `${keyLong(days[0].key)} – ${keyLong(days[days.length - 1].key)} (${days.length} day${days.length === 1 ? "" : "s"})`
                  : "No data"}
              </dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>
                {data.settings.dueDate
                  ? keyLong(data.settings.dueDate)
                  : "Not set"}
              </dd>
            </div>
            {data.pregnancy && (
              <div>
                <dt>Pregnancy</dt>
                <dd>{formatPregnancy(data.pregnancy)}</dd>
              </div>
            )}
            <div>
              <dt>Generated</dt>
              <dd>{generated}</dd>
            </div>
          </dl>
          <p className="muted small">
            Movements are logged per waking hour (kicks, rolls, other); the
            night is one entry, counted on the day it ends. Today is still in
            progress.
          </p>

          <section className="sum-section">
            <h2>Daily totals</h2>
            {days.length === 0 ? (
              <p className="muted">No days logged yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="sum-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Kicks</th>
                      <th scope="col">Rolls</th>
                      <th scope="col">Other</th>
                      <th scope="col">Total</th>
                      <th scope="col">Night</th>
                      <th scope="col">Logged h</th>
                      <th scope="col">Skipped h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const isLow = low.has(d.key);
                      return (
                        <tr key={d.key} className={isLow ? "low" : undefined}>
                          <th scope="row">
                            {keyShort(d.key)}
                            {d.key === data.today.key ? " (today)" : ""}
                            {isLow && <span className="low-mark"> ▲ low</span>}
                          </th>
                          <td>{d.kicks}</td>
                          <td>{d.rolls}</td>
                          <td>{d.other}</td>
                          <td>
                            <b>{d.total}</b>
                          </td>
                          <td>{d.night ?? "–"}</td>
                          <td>{round1(d.loggedHours)}</td>
                          <td>{round1(d.skippedHours)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="sum-section">
            <h2>Flagged low days</h2>
            <p className="muted small">
              Day total below 50% of the average of the previous 7 days with
              data (needs at least {LOW_MIN_BASELINE_DAYS} such days; today is
              not flagged).
            </p>
            {low.size === 0 ? (
              <p>None.</p>
            ) : (
              <ul className="sum-list">
                {days
                  .filter((d) => low.has(d.key))
                  .map((d) => (
                    <li key={d.key}>
                      {keyShort(d.key)}: <b>{d.total}</b> movements (previous
                      average {round1(low.get(d.key) ?? 0)}),{" "}
                      {round1(d.loggedHours)} h logged
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section className="sum-section">
            <h2>Weekly averages</h2>
            {weeks.length === 0 ? (
              <p className="muted">No data.</p>
            ) : (
              <div className="table-wrap">
                <table className="sum-table">
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col">Dates</th>
                      <th scope="col">Days logged</th>
                      <th scope="col">Avg / day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w.startKey}>
                        <th scope="row">{w.label}</th>
                        <td className="left">
                          {keyShort(w.startKey)} – {keyShort(w.endKey)}
                        </td>
                        <td>{w.days}</td>
                        <td>
                          <b>{round1(w.avgPerDay)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="sum-section">
            <h2>Hourly pattern, last 7 days</h2>
            <p className="muted small">
              Each column is a waking hour (by start time); darker = more
              movements. Faded columns are within the sleep window.
            </p>
            <ActivityGrid
              grid={data.grid}
              hourAvg={data.hourAvg}
              settings={data.settings}
            />
          </section>
        </>
      )}
    </div>
  );
}
