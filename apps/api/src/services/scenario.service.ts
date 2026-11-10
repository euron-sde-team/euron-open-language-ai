/**
 * Scenarios: the role-plays a learner picks from. Learners read the active ones (never the
 * role-play text); admins manage all of them, and every change is audited in the same
 * transaction.
 */
import { LEVELS, type AdminScenario, type Scenario, type ScenarioInput } from "@open-language/types";
import { sql } from "kysely";
import { type Actor, type RequestMeta, requireActor, requireAdmin } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { toAdminScenario, toScenario, type ScenarioRow } from "../presenters/practice.presenter";
import { audit } from "./audit.service";
import { profileRow } from "./profile.service";

/** Active scenarios in display order; `forProfile` keeps those that fit the learner's level and goals. */
export async function listScenarios(actor: Actor, opts: { forProfile?: boolean }): Promise<Scenario[]> {
  const a = requireActor(actor);
  let q = db.selectFrom("scenarios").selectAll().where("is_active", "=", true);
  if (opts.forProfile) {
    const p = await profileRow(a.id);
    q = q
      .where("level_min", "<=", p.level)
      .where("level_max", ">=", p.level)
      // A scenario with no goals suits everyone; otherwise one shared goal is enough.
      .where(sql<boolean>`(goals = '{}' OR goals && ${p.goals}::text[])`);
  }
  return (await q.orderBy("sort_order").orderBy("created_at").orderBy("id").execute()).map(toScenario);
}

export async function activeScenario(id: string, exec: Executor = db): Promise<ScenarioRow | undefined> {
  return exec.selectFrom("scenarios").selectAll().where("id", "=", id).where("is_active", "=", true).executeTakeFirst();
}

export async function getScenario(actor: Actor, id: string): Promise<Scenario> {
  requireActor(actor);
  const row = await activeScenario(id);
  if (!row) throw notFound("Scenario not found", "SCENARIO_NOT_FOUND");
  return toScenario(row);
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function listAllScenarios(actor: Actor): Promise<AdminScenario[]> {
  requireAdmin(actor);
  return (await db.selectFrom("scenarios").selectAll().orderBy("sort_order").orderBy("created_at").orderBy("id").execute()).map(toAdminScenario);
}

function values(input: ScenarioInput) {
  if (LEVELS.indexOf(input.levelMin) > LEVELS.indexOf(input.levelMax)) throw badRequest("The lowest level cannot be above the highest", "LEVEL_RANGE_INVALID");
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    level_min: input.levelMin,
    level_max: input.levelMax,
    goals: [...new Set(input.goals)],
    prompt_template: input.promptTemplate.trim(),
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
  };
}

export async function createScenario(actor: Actor, input: ScenarioInput, meta: RequestMeta): Promise<AdminScenario> {
  requireAdmin(actor);
  const v = values(input);
  return withTransaction(async (trx) => {
    const last = await trx.selectFrom("scenarios").select((eb) => eb.fn.max("sort_order").as("m")).executeTakeFirst();
    const row = await trx
      .insertInto("scenarios")
      .values({ id: newId(), ...v, sort_order: v.sort_order ?? Number(last?.m ?? 0) + 10 })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit({ actorId: actor.id, action: "scenario.create", entityType: "scenario", entityId: row.id, ip: meta.ip, data: { title: row.title, isActive: row.is_active } }, trx);
    return toAdminScenario(row);
  });
}

export async function updateScenario(actor: Actor, id: string, input: ScenarioInput, meta: RequestMeta): Promise<AdminScenario> {
  requireAdmin(actor);
  const v = values(input);
  return withTransaction(async (trx) => {
    const before = await trx.selectFrom("scenarios").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!before) throw notFound("Scenario not found", "SCENARIO_NOT_FOUND");
    const row = await trx.updateTable("scenarios").set({ ...v, updated_at: new Date() }).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((row as unknown as Record<string, unknown>)[k]));
    // The role-play text can be long: the audit trail says it changed, not what it said.
    await audit({ actorId: actor.id, action: "scenario.update", entityType: "scenario", entityId: id, ip: meta.ip, data: { title: row.title, changed } }, trx);
    return toAdminScenario(row);
  });
}

/** Practice sessions that used it keep their title; their scenario link becomes empty. */
export async function deleteScenario(actor: Actor, id: string, meta: RequestMeta): Promise<void> {
  requireAdmin(actor);
  await withTransaction(async (trx) => {
    const gone = await trx.deleteFrom("scenarios").where("id", "=", id).returning("title").executeTakeFirst();
    if (!gone) throw notFound("Scenario not found", "SCENARIO_NOT_FOUND");
    await audit({ actorId: actor.id, action: "scenario.delete", entityType: "scenario", entityId: id, ip: meta.ip, data: { title: gone.title } }, trx);
  });
}
