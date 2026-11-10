/** Geometry and words for the progress charts. Plain numbers in, plain numbers out, so it is testable. */
import type { DayActivity, ScorePoint } from "@open-language/types";

/** Intensity 0 to 4 for the activity strip: none, under 5, under 15, under 30, 30 or more minutes. */
export function activityLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 5) return 1;
  if (minutes < 15) return 2;
  if (minutes < 30) return 3;
  return 4;
}

export function activityTitle(d: DayActivity): string {
  const when = new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (d.sessions === 0) return `${when}: no practice`;
  return `${when}: ${d.minutes} ${d.minutes === 1 ? "minute" : "minutes"}, ${d.sessions} ${d.sessions === 1 ? "session" : "sessions"}`;
}

export interface TrendGeometry {
  /** SVG polyline `points` for the overall score, or "" with fewer than two points. */
  line: string;
  dots: { x: number; y: number; score: number; at: string }[];
  /** y of the 1 to 10 gridlines at 2, 4, 6, 8 and 10. */
  grid: { y: number; label: string }[];
}

/** Lay the score trend (1 to 10) out in a `width` by `height` box with `pad` around it. */
export function trendGeometry(points: readonly ScorePoint[], width: number, height: number, pad = 12): TrendGeometry {
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const y = (score: number) => pad + innerH - ((Math.min(10, Math.max(1, score)) - 1) / 9) * innerH;
  const x = (i: number) => (points.length <= 1 ? pad + innerW / 2 : pad + (i / (points.length - 1)) * innerW);
  const dots = points.map((p, i) => ({ x: round(x(i)), y: round(y(p.overall)), score: p.overall, at: p.at }));
  return {
    line: dots.length >= 2 ? dots.map((d) => `${d.x},${d.y}`).join(" ") : "",
    dots,
    grid: [2, 4, 6, 8, 10].map((s) => ({ y: round(y(s)), label: String(s) })),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The change between the mean of the first and the last third of the trend, or null with fewer than 4 sessions. */
export function trendDelta(points: readonly ScorePoint[]): number | null {
  if (points.length < 4) return null;
  const third = Math.max(1, Math.floor(points.length / 3));
  const mean = (xs: readonly ScorePoint[]) => xs.reduce((n, p) => n + p.overall, 0) / xs.length;
  return round(mean(points.slice(-third)) - mean(points.slice(0, third)));
}

export function streakText(days: number): string {
  if (days <= 0) return "No streak yet";
  return days === 1 ? "1 day streak" : `${days} day streak`;
}

/** Progress toward the daily goal as 0 to 1. */
export function goalProgress(minutesToday: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, minutesToday / target));
}
