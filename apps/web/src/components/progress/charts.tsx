"use client";

/** Plain-SVG charts for the progress page: no chart library. Colour is never the only signal: every mark has a text title. */
import type { CorrectionType, DayActivity, ScorePoint } from "@open-language/types";
import { CORRECTION_LABEL } from "@/lib/language/format";
import { activityLevel, activityTitle, trendGeometry } from "@/lib/language/progress";

const LEVEL_FILL = ["fill-muted", "fill-primary/25", "fill-primary/50", "fill-primary/75", "fill-primary"] as const;

/** The last 28 days as one strip, oldest first, one cell per day. */
export function ActivityStrip({ days }: { days: DayActivity[] }) {
  const cell = 18;
  const gap = 4;
  const w = Math.max(1, days.length) * (cell + gap) - gap;
  const h = cell;
  const active = days.filter((d) => d.sessions > 0).length;
  const total = days.reduce((n, d) => n + d.minutes, 0);
  return (
    <svg
      role="img"
      aria-label={`Practice over the last ${days.length} days: ${active} active ${active === 1 ? "day" : "days"}, ${total} minutes in total`}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full max-w-[620px]"
      data-testid="activity-strip"
    >
      {days.map((d, i) => (
        <rect key={d.date} x={i * (cell + gap)} y={0} width={cell} height={cell} rx={4} className={LEVEL_FILL[activityLevel(d.minutes)]}>
          <title>{activityTitle(d)}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Overall score (1 to 10) of the last sessions, oldest first. */
export function ScoreTrend({ points }: { points: ScorePoint[] }) {
  const w = 560;
  const h = 180;
  const g = trendGeometry(points, w, h, 20);
  const last = points[points.length - 1];
  return (
    <svg
      role="img"
      aria-label={points.length ? `Overall score over your last ${points.length} ${points.length === 1 ? "session" : "sessions"}, most recent ${last!.overall} out of 10` : "No scored sessions yet"}
      viewBox={`0 0 ${w} ${h}`}
      className="w-full max-w-[560px]"
      data-testid="score-trend"
    >
      {g.grid.map((l) => (
        <g key={l.label}>
          <line x1={20} x2={w - 20} y1={l.y} y2={l.y} className="stroke-border" strokeWidth={1} />
          <text x={0} y={l.y + 4} className="fill-subtle-foreground text-[10px]">
            {l.label}
          </text>
        </g>
      ))}
      {g.line ? <polyline points={g.line} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {g.dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={3.5} className="fill-primary">
          <title>{`${new Date(d.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${d.score} out of 10`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** The most frequent correction types as horizontal bars with the count as text. */
export function WeakSpots({ items }: { items: { type: CorrectionType; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const row = 34;
  return (
    <svg role="img" aria-label={`Most common corrections: ${items.map((i) => `${CORRECTION_LABEL[i.type]} ${i.count}`).join(", ")}`} viewBox={`0 0 560 ${items.length * row}`} className="w-full max-w-[560px]" data-testid="weak-spots">
      {items.map((it, i) => {
        const bar = Math.max(4, (it.count / max) * 330);
        return (
          <g key={it.type} transform={`translate(0 ${i * row})`}>
            <text x={0} y={20} className="fill-foreground text-[13px]">
              {CORRECTION_LABEL[it.type]}
            </text>
            <rect x={130} y={6} width={bar} height={18} rx={4} className="fill-primary/70" />
            <text x={130 + bar + 8} y={20} className="fill-muted-foreground text-[13px] tabular-nums">
              {it.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
