/**
 * Pick the lesson engine and run it. With a usable text model the LLM engine writes the
 * report; with none configured, or when the model fails twice, the offline engine does,
 * and the report records which one it was.
 */
import type { TranscriptLine } from "@open-language/types";
import { captureError } from "../../../core/logger";
import { resolveTextModel } from "../../models.service";
import { ModelOutputError } from "../ai";
import { analyzeWithModel } from "./llm";
import { analyzeOffline } from "./offline";
import { hasLearnerSpeech, type EngineName, type LessonInput, type LessonResult } from "./types";

export interface LessonRun {
  engine: EngineName;
  result: LessonResult;
}

export async function runLesson(input: LessonInput, ctx: { userId: string; textModelId: string | null }): Promise<LessonRun> {
  // Nothing from the learner: there is nothing for a model to judge, and no reason to spend tokens.
  if (!hasLearnerSpeech(input.transcript as TranscriptLine[])) return { engine: "offline", result: analyzeOffline(input) };
  const model = await resolveTextModel(ctx.textModelId);
  if (model) {
    try {
      return { engine: "llm", result: await analyzeWithModel(model, ctx.userId, input) };
    } catch (err) {
      if (!(err instanceof ModelOutputError)) captureError(err, { where: "lesson.llm" });
    }
  }
  return { engine: "offline", result: analyzeOffline(input) };
}

export { analyzeOffline, drillsFor } from "./offline";
export { overallOf } from "./types";
export type { EngineName, LessonInput, LessonResult } from "./types";
