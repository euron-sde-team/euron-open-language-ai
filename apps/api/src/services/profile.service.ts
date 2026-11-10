/**
 * The learner profile: native and target language, level, goals, a daily minutes target
 * and whether onboarding is finished. One row per user, created with defaults the first
 * time it is read (native English, target Spanish, level A1, goal DAILY).
 */
import type { LearnerProfile, LearnerProfilePatch } from "@open-language/types";
import { type Actor, requireActive, requireActor } from "../core/context";
import { badRequest } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { isKnownLanguage, isTeachable } from "../domain/languages";
import { toProfile, type ProfileRow } from "../presenters/practice.presenter";

export async function profileRow(userId: string, exec: Executor = db): Promise<ProfileRow> {
  const found = await exec.selectFrom("learner_profiles").selectAll().where("user_id", "=", userId).executeTakeFirst();
  if (found) return found;
  await exec.insertInto("learner_profiles").values({ user_id: userId }).onConflict((oc) => oc.column("user_id").doNothing()).execute();
  return exec.selectFrom("learner_profiles").selectAll().where("user_id", "=", userId).executeTakeFirstOrThrow();
}

export async function getProfile(actor: Actor): Promise<LearnerProfile> {
  return toProfile(await profileRow(requireActor(actor).id));
}

export async function updateProfile(actor: Actor, patch: LearnerProfilePatch): Promise<LearnerProfile> {
  const a = requireActive(actor);
  const current = await profileRow(a.id);
  const native = patch.nativeLanguage ?? current.native_language;
  const target = patch.targetLanguage ?? current.target_language;
  if (patch.nativeLanguage !== undefined && !isKnownLanguage(native)) throw badRequest("That native language is not supported", "LANGUAGE_UNKNOWN");
  if (patch.targetLanguage !== undefined) {
    if (!isKnownLanguage(target)) throw badRequest("That language is not supported", "LANGUAGE_UNKNOWN");
    if (!isTeachable(target)) throw badRequest("The tutor cannot teach that language yet", "LANGUAGE_NOT_TEACHABLE");
  }
  if (native === target) throw badRequest("Choose a target language different from your own", "LANGUAGE_SAME");
  if (patch.goals !== undefined && !patch.goals.length) throw badRequest("Choose at least one goal", "GOALS_REQUIRED");
  const goals = patch.goals ? [...new Set(patch.goals)] : undefined;
  const updated = await db
    .updateTable("learner_profiles")
    .set({
      native_language: native,
      target_language: target,
      ...(patch.level !== undefined ? { level: patch.level } : {}),
      ...(goals ? { goals } : {}),
      ...(patch.dailyMinutesTarget !== undefined ? { daily_minutes_target: patch.dailyMinutesTarget } : {}),
      ...(patch.onboardingComplete !== undefined ? { onboarding_complete: patch.onboardingComplete } : {}),
      updated_at: new Date(),
    })
    .where("user_id", "=", a.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return toProfile(updated);
}
