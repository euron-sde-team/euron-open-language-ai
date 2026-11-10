import { describe, expect, it } from "vitest";
import { REVIEW_GRADES, dueLabel, dueSummary, gradeForKey, masteredPercent, stageOf } from "@/lib/language/srs";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

describe("dueLabel", () => {
  it("says when a card is due", () => {
    expect(dueLabel(at(-5 * D), NOW)).toBe("Due now");
    expect(dueLabel(at(0), NOW)).toBe("Due now");
    expect(dueLabel(at(3 * H), NOW)).toBe("Due today");
    expect(dueLabel(at(20 * H), NOW)).toBe("Tomorrow");
    expect(dueLabel(at(5 * D), NOW)).toBe("In 5 days");
    expect(dueLabel(at(21 * D), NOW)).toBe("In 3 weeks");
    expect(dueLabel(at(90 * D), NOW)).toBe("In 3 months");
    expect(dueLabel("not a date", NOW)).toBe("");
  });
});

describe("stages and summaries", () => {
  it("names the stage of a card", () => {
    expect(stageOf({ repetitions: 0, mastered: false })).toBe("new");
    expect(stageOf({ repetitions: 3, mastered: false })).toBe("learning");
    expect(stageOf({ repetitions: 9, mastered: true })).toBe("mastered");
  });
  it("words the due count", () => {
    expect(dueSummary(0)).toBe("Nothing due");
    expect(dueSummary(1)).toBe("1 card due");
    expect(dueSummary(12)).toBe("12 cards due");
  });
  it("computes the mastered share without dividing by zero", () => {
    expect(masteredPercent(0, 0)).toBe(0);
    expect(masteredPercent(25, 5)).toBe(20);
    expect(masteredPercent(3, 9)).toBe(100);
  });
});

describe("grades", () => {
  it("maps keys 1 to 4 to again, hard, good, easy", () => {
    expect(REVIEW_GRADES.map((g) => g.grade)).toEqual(["again", "hard", "good", "easy"]);
    expect(gradeForKey("1")).toBe("again");
    expect(gradeForKey("4")).toBe("easy");
    expect(gradeForKey("5")).toBeNull();
    expect(gradeForKey("a")).toBeNull();
  });
});
