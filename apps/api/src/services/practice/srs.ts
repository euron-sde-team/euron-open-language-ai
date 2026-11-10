/**
 * Spaced repetition, SM-2 style. A card has an ease (how fast its gaps grow, 2.5 to start,
 * never below 1.3), an interval in days and a count of correct reviews in a row.
 *
 *   again   forgot it: the count resets, the ease drops 0.2, it comes back in 10 minutes
 *   hard    recalled with effort: the interval grows by x1.2 (at least one day more), ease -0.15
 *   good    recalled: 1 day, then 6 days, then the interval x ease
 *   easy    recalled at once: the interval x ease x 1.3 (4 days at first), ease +0.15
 *
 * An item whose interval has reached 21 days is mastered. Pure functions: the clock comes
 * in as an argument so the tests are exact.
 */
import type { ReviewGrade } from "@open-language/types";

export const MASTERED_DAYS = 21;
export const MIN_EASE = 1.3;
export const AGAIN_MINUTES = 10;
const DAY_MS = 86_400_000;

export interface Card {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

export interface NextCard extends Card {
  nextReviewAt: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function gradeCard(card: Card, grade: ReviewGrade, now = new Date()): NextCard {
  const { ease, intervalDays: interval, repetitions: reps } = card;
  if (grade === "again") {
    return { ease: round2(Math.max(MIN_EASE, ease - 0.2)), intervalDays: 0, repetitions: 0, nextReviewAt: new Date(now.getTime() + AGAIN_MINUTES * 60_000) };
  }
  let nextEase = ease;
  let days: number;
  if (grade === "hard") {
    days = reps === 0 ? 1 : Math.max(interval + 1, Math.round(interval * 1.2));
    nextEase = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === "good") {
    days = reps === 0 ? 1 : reps === 1 ? 6 : Math.max(interval + 1, Math.round(interval * ease));
  } else {
    days = reps === 0 ? 4 : Math.max(interval + 1, Math.round(Math.max(interval, 1) * ease * 1.3));
    nextEase = ease + 0.15;
  }
  return { ease: round2(nextEase), intervalDays: days, repetitions: reps + 1, nextReviewAt: new Date(now.getTime() + days * DAY_MS) };
}

export const isMastered = (intervalDays: number): boolean => intervalDays >= MASTERED_DAYS;
