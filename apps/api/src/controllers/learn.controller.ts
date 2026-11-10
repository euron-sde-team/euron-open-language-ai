/** Profile, dashboard, scenarios, vocabulary and review. Thin controllers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { GOALS, LEVELS } from "@open-language/types";
import { id, idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import { dashboardOf } from "../services/dashboard.service";
import * as profile from "../services/profile.service";
import { reviewToday, gradeReview } from "../services/review.service";
import * as scenarios from "../services/scenario.service";
import * as vocab from "../services/vocab.service";

const lang = z.string().regex(/^[a-z]{2}$/, "a two-letter language code");

export async function getProfile(req: Request, res: Response) {
  res.json(await profile.getProfile(actorOf(req)));
}

export async function putProfile(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        nativeLanguage: lang,
        targetLanguage: lang,
        level: z.enum(LEVELS),
        goals: z.array(z.enum(GOALS)).min(1).max(GOALS.length),
        dailyMinutesTarget: z.number().int().min(1).max(240),
        onboardingComplete: z.boolean(),
      })
      .partial()
      .strict(),
    req.body,
  );
  res.json(await profile.updateProfile(actorOf(req), body));
}

export async function dashboard(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await dashboardOf(actorOf(req)));
}

export async function listScenarios(req: Request, res: Response) {
  const q = parse(z.object({ forProfile: z.enum(["true", "false"]).optional() }), req.query);
  res.json(await scenarios.listScenarios(actorOf(req), { forProfile: q.forProfile === "true" }));
}

export async function getScenario(req: Request, res: Response) {
  res.json(await scenarios.getScenario(actorOf(req), parse(idParam, req.params).id));
}

export async function listVocab(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ q: z.string().trim().max(100).optional() }), req.query);
  res.json(await vocab.listVocab(actorOf(req), q));
}

export async function saveVocab(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        phrase: z.string().trim().min(1).max(200),
        meaningNative: z.string().trim().min(1).max(300),
        examples: z.array(z.string().trim().min(1).max(500)).max(5).optional(),
        sessionId: id().optional(),
      })
      .strict(),
    req.body,
  );
  res.status(201).json(await vocab.saveVocab(actorOf(req), body));
}

export async function deleteVocab(req: Request, res: Response) {
  await vocab.deleteVocab(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function today(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await reviewToday(actorOf(req)));
}

export async function grade(req: Request, res: Response) {
  const body = parse(z.object({ vocabId: id(), grade: z.enum(["again", "hard", "good", "easy"]) }).strict(), req.body);
  res.json(await gradeReview(actorOf(req), body));
}
