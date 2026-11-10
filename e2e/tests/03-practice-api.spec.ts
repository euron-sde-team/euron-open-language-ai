import { expect, test } from "@playwright/test";
import { as, call, completedPractice, newUser, onboard, uniq } from "../helpers";

test("practice is owner-scoped: another learner gets a 404, an anonymous caller a 401", async ({ request }) => {
  const owner = await newUser(request);
  const s = await completedPractice(request, owner);
  const other = await newUser(request);
  await onboard(request, other);
  await call(request, "GET", `/practice/${s.id}`, { token: other.accessToken, ip: other.ip, expect: 404 });
  await call(request, "GET", `/practice/${s.id}`, { expect: 401 });
  await call(request, "DELETE", `/practice/${s.id}`, { token: other.accessToken, ip: other.ip, expect: 404 });
});

test("starting practice before onboarding is refused with PROFILE_INCOMPLETE", async ({ request }) => {
  const user = await newUser(request);
  const r = await call<{ code: string }>(request, "POST", "/practice", { token: user.accessToken, ip: user.ip, data: {}, expect: 409 });
  expect(r.code).toBe("PROFILE_INCOMPLETE");
});

test("saving a phrase twice keeps one card", async ({ request }) => {
  const user = await newUser(request);
  const phrase = uniq("hola");
  await as(request, user, "POST", "/vocab", { phrase, meaningNative: "hello" });
  await as(request, user, "POST", "/vocab", { phrase: phrase.toUpperCase(), meaningNative: "hello" });
  const list = await as<{ items: unknown[] }>(request, user, "GET", `/vocab?q=${phrase}`);
  expect(list.items).toHaveLength(1);
});
