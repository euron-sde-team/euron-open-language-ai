/** The admin scenario form: draft shape, validation matching the API's limits, and the request body. */
import { LEVELS, type Goal, type Level, type ScenarioInput } from "@open-language/types";

export interface ScenarioDraft {
  title: string;
  description: string;
  levelMin: Level;
  levelMax: Level;
  goals: Goal[];
  promptTemplate: string;
  /** Empty means "put it last" (the server picks the order). */
  sortOrder: string;
  isActive: boolean;
}

export function scenarioErrors(d: ScenarioDraft): Partial<Record<keyof ScenarioDraft, string>> {
  const e: Partial<Record<keyof ScenarioDraft, string>> = {};
  if (!d.title.trim()) e.title = "Give the scenario a title.";
  else if (d.title.trim().length > 80) e.title = "Use 80 characters or fewer.";
  if (!d.description.trim()) e.description = "Add a sentence learners will see.";
  else if (d.description.trim().length > 300) e.description = "Use 300 characters or fewer.";
  if (LEVELS.indexOf(d.levelMin) > LEVELS.indexOf(d.levelMax)) e.levelMax = "The highest level must not be below the lowest.";
  if (!d.goals.length) e.goals = "Pick at least one goal.";
  if (d.promptTemplate.trim().length < 20) e.promptTemplate = "Describe the role in at least 20 characters.";
  else if (d.promptTemplate.length > 4000) e.promptTemplate = "Use 4,000 characters or fewer.";
  if (d.sortOrder.trim() && !/^\d{1,6}$/.test(d.sortOrder.trim())) e.sortOrder = "Use a whole number.";
  return e;
}

export function toScenarioInput(d: ScenarioDraft): ScenarioInput {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    levelMin: d.levelMin,
    levelMax: d.levelMax,
    goals: d.goals,
    promptTemplate: d.promptTemplate.trim(),
    ...(d.sortOrder.trim() ? { sortOrder: Number(d.sortOrder.trim()) } : {}),
    isActive: d.isActive,
  };
}
