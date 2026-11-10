/** Spaced repetition: the four grades, the first steps, the floor on ease, the mastery line. */
import { describe, expect, test } from "vitest";
import { AGAIN_MINUTES, gradeCard, isMastered, MIN_EASE, type Card } from "../../src/services/practice/srs";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const fresh: Card = { ease: 2.5, intervalDays: 0, repetitions: 0 };
const days = (d: Date) => Math.round((d.getTime() - NOW.getTime()) / 86_400_000);

describe("gradeCard", () => {
  test("good: 1 day, then 6 days, then the interval times the ease", () => {
    const one = gradeCard(fresh, "good", NOW);
    expect(one).toMatchObject({ intervalDays: 1, repetitions: 1, ease: 2.5 });
    expect(days(one.nextReviewAt)).toBe(1);
    const six = gradeCard(one, "good", NOW);
    expect(six).toMatchObject({ intervalDays: 6, repetitions: 2 });
    const next = gradeCard(six, "good", NOW);
    expect(next).toMatchObject({ intervalDays: 15, repetitions: 3 });
    expect(days(next.nextReviewAt)).toBe(15);
  });

  test("again resets the count and the interval, lowers the ease and comes back in ten minutes", () => {
    const card: Card = { ease: 2.5, intervalDays: 30, repetitions: 5 };
    const r = gradeCard(card, "again", NOW);
    expect(r).toMatchObject({ intervalDays: 0, repetitions: 0, ease: 2.3 });
    expect(r.nextReviewAt.getTime() - NOW.getTime()).toBe(AGAIN_MINUTES * 60_000);
  });

  test("hard grows the interval by x1.2 (at least a day more) and lowers the ease", () => {
    expect(gradeCard({ ease: 2.5, intervalDays: 10, repetitions: 3 }, "hard", NOW)).toMatchObject({ intervalDays: 12, ease: 2.35, repetitions: 4 });
    expect(gradeCard({ ease: 2.5, intervalDays: 2, repetitions: 3 }, "hard", NOW).intervalDays).toBe(3);
    expect(gradeCard(fresh, "hard", NOW).intervalDays).toBe(1);
  });

  test("easy multiplies by the ease and 1.3 and raises the ease; a new card waits four days", () => {
    expect(gradeCard(fresh, "easy", NOW)).toMatchObject({ intervalDays: 4, ease: 2.65 });
    expect(gradeCard({ ease: 2.5, intervalDays: 10, repetitions: 3 }, "easy", NOW).intervalDays).toBe(33);
  });

  test("the ease never falls below 1.3, and a hard or good review always moves the date forward", () => {
    let c: Card = { ease: 1.35, intervalDays: 3, repetitions: 4 };
    for (let i = 0; i < 5; i++) c = gradeCard(c, "again", NOW);
    expect(c.ease).toBe(MIN_EASE);
    const h = gradeCard({ ease: 1.3, intervalDays: 4, repetitions: 2 }, "hard", NOW);
    expect(h.ease).toBe(MIN_EASE);
    expect(h.intervalDays).toBeGreaterThan(4);
    expect(gradeCard({ ease: 1.3, intervalDays: 4, repetitions: 5 }, "good", NOW).intervalDays).toBeGreaterThan(4);
  });
});

describe("isMastered", () => {
  test("21 days and up", () => {
    expect(isMastered(20)).toBe(false);
    expect(isMastered(21)).toBe(true);
    expect(isMastered(200)).toBe(true);
  });
});
