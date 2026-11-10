/**
 * The twelve starter role-plays, adapted from the language tutor this product grew out of.
 * A new install gets them once (src/index.ts, and demo:seed); after that they are the
 * admin's to edit, reorder, switch off or delete at /admin/scenarios.
 *
 * `promptTemplate` is the role-play text added to the tutor's instructions. It never goes
 * to a learner.
 */
import type { Goal, Level } from "@open-language/types";
import { newId } from "../core/ids";
import type { Executor } from "../db/kysely";

interface Starter {
  title: string;
  description: string;
  levelMin: Level;
  levelMax: Level;
  goals: Goal[];
  promptTemplate: string;
}

export const STARTER_SCENARIOS: readonly Starter[] = [
  {
    title: "Airport immigration",
    description: "Answer an officer's questions about your trip at passport control.",
    levelMin: "A1",
    levelMax: "A2",
    goals: ["TRAVEL"],
    promptTemplate: `You are an immigration officer at an airport. The learner is a traveler. Role-play: they approach your desk with a passport and boarding pass. Ask for their purpose of visit, duration of stay, and where they will stay. Keep the conversation short and clear. Correct any language mistakes gently with "Quick correction: ..." then continue.`,
  },
  {
    title: "Ordering food",
    description: "Sit down at a restaurant, order a meal and a drink, and mention what you cannot eat.",
    levelMin: "A1",
    levelMax: "A1",
    goals: ["TRAVEL", "DAILY"],
    promptTemplate: `You are a waiter at a casual restaurant. The learner is a customer. Role-play: they sit down and order food and drinks. Ask about preferences (allergies, size, how they want something cooked). Keep sentences simple. Correct gently.`,
  },
  {
    title: "Asking directions",
    description: "You are lost in a new city. Ask a local how to reach the station or a museum.",
    levelMin: "A1",
    levelMax: "A1",
    goals: ["TRAVEL", "DAILY"],
    promptTemplate: `You are a local on the street. The learner is lost and asks for directions to a landmark (for example a train station or a museum). Give simple directions (left, right, straight, five minutes). Use common place words. Correct gently.`,
  },
  {
    title: "Hotel check-in",
    description: "Check in at the front desk, confirm your stay and ask about breakfast and WiFi.",
    levelMin: "A2",
    levelMax: "A2",
    goals: ["TRAVEL"],
    promptTemplate: `You are a hotel receptionist. The learner has a reservation and is checking in. Ask for ID, confirm the length of stay, and explain breakfast times and WiFi. Role-play professionally. Correct gently.`,
  },
  {
    title: "Small talk with a coworker",
    description: "Chat in the break room about your weekend plans, the weather and a show.",
    levelMin: "A2",
    levelMax: "A2",
    goals: ["DAILY", "BUSINESS"],
    promptTemplate: `You are a friendly coworker in the break room. The learner joins you. Make small talk: weekend plans, the weather, a recent project or show. Keep it natural and not too long. Correct gently.`,
  },
  {
    title: "Job interview",
    description: "Talk about your experience, a challenge you overcame and why you want the job.",
    levelMin: "B1",
    levelMax: "B2",
    goals: ["INTERVIEW", "BUSINESS"],
    promptTemplate: `You are an interviewer for a mid-level role. The learner is the candidate. Ask about their experience, strengths, a challenge they overcame, and why they want this job. Be professional and encouraging. Correct gently.`,
  },
  {
    title: "Client meeting",
    description: "Run a short meeting with a client: agenda, project updates and next steps.",
    levelMin: "B2",
    levelMax: "B2",
    goals: ["BUSINESS"],
    promptTemplate: `You are a client. The learner is your account manager or consultant. Role-play a short meeting: agenda, updates on a project, next steps. Keep the tone professional. Correct gently.`,
  },
  {
    title: "Phone call to support",
    description: "Call customer support about a late delivery or a billing question.",
    levelMin: "B1",
    levelMax: "B1",
    goals: ["DAILY", "BUSINESS"],
    promptTemplate: `You are a customer support agent. The learner is calling about a problem (for example a late delivery or a billing question). Ask for their order number or account, understand the issue, and offer a solution. Correct gently.`,
  },
  {
    title: "Doctor visit",
    description: "Describe your symptoms to a doctor and understand the advice you are given.",
    levelMin: "A2",
    levelMax: "B1",
    goals: ["DAILY", "TRAVEL"],
    promptTemplate: `You are a doctor. The learner is a patient describing symptoms. Ask where it hurts, for how long, and about any other symptoms. Give simple advice (rest, medicine, come back if it gets worse). Correct gently.`,
  },
  {
    title: "Shopping and negotiation",
    description: "Bargain with a market vendor over the price of a souvenir.",
    levelMin: "A2",
    levelMax: "A2",
    goals: ["TRAVEL", "DAILY"],
    promptTemplate: `You are a market vendor. The learner is bargaining for a souvenir or an item. State a price, react to their offer, and meet halfway. Keep it short and friendly. Correct gently.`,
  },
  {
    title: "Presentation practice",
    description: "Present a topic from work to an audience and answer their questions.",
    levelMin: "B2",
    levelMax: "B2",
    goals: ["BUSINESS", "INTERVIEW"],
    promptTemplate: `You are the audience for a short work presentation. The learner is presenting a topic (for example quarterly results or a proposal). Listen, then ask one or two clarifying questions. Give brief positive feedback. Correct gently.`,
  },
  {
    title: "Debate topic",
    description: "Argue one side of a simple topic, such as remote work, with a respectful partner.",
    levelMin: "C1",
    levelMax: "C1",
    goals: ["ACADEMIC", "BUSINESS"],
    promptTemplate: `You are a debate partner. Pick a simple topic (for example "Remote work is better than office work"). The learner takes one side; you take the other. Exchange two or three points each. Keep it respectful. Correct gently.`,
  },
];

/**
 * Insert the starter scenarios on a brand-new install: only when there are none and they
 * were never seeded, so an admin who deletes them all does not get them back at the next boot.
 * Returns how many were inserted.
 */
export async function ensureStarterScenarios(exec: Executor): Promise<number> {
  const seeded = await exec.selectFrom("settings").select("key").where("key", "=", "starter_scenarios").executeTakeFirst();
  if (seeded || (await exec.selectFrom("scenarios").select("id").limit(1).executeTakeFirst())) return 0;
  let order = 10;
  for (const s of STARTER_SCENARIOS) {
    await exec
      .insertInto("scenarios")
      .values({ id: newId(), title: s.title, description: s.description, level_min: s.levelMin, level_max: s.levelMax, goals: s.goals, prompt_template: s.promptTemplate, sort_order: order })
      .execute();
    order += 10;
  }
  await exec.insertInto("settings").values({ key: "starter_scenarios", value: JSON.stringify({ at: new Date().toISOString() }) }).onConflict((oc) => oc.column("key").doNothing()).execute();
  return STARTER_SCENARIOS.length;
}
