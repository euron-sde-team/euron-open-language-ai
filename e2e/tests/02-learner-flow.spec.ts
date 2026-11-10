import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientIp, finishSignup, LEARNER_LINES, newContext, uniq } from "../helpers";

/**
 * The whole learner journey in a real browser, against the stub tutor: sign up, set up
 * the languages, pick a scenario, talk in the room, end, read the lesson, save a word to
 * the deck and review it.
 */
test("sign up, onboard, practise a scenario, read the lesson, save a word and review it", async ({ browser }) => {
  const ip = clientIp();
  const ctx = await newContext(browser, ip);
  const page = await ctx.newPage();
  const username = uniq("lf");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;
  let sessionId = "";

  await test.step("sign up", async () => {
    await page.goto("/signup");
    await page.locator("#email").fill(email);
    await page.locator("#displayName").fill("Flow Tester");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByTestId("signup-submit").click();
    await finishSignup(page, email);
    await expect(page).toHaveURL(/\/onboarding/);
  });

  await test.step("onboarding: languages, level, goals and a daily target", async () => {
    await expect(page.getByTestId("onboarding-step")).toHaveText("Step 1 of 4");
    await page.getByTestId("native-language").selectOption("en");
    await page.getByTestId("onboarding-next").click();
    await expect(page.getByTestId("onboarding-step")).toHaveText("Step 2 of 4");
    await page.getByTestId("target-language").selectOption("es");
    await page.getByTestId("onboarding-next").click();
    await page.getByText("B1 Intermediate", { exact: true }).click();
    await expect(page.getByTestId("level-B1")).toBeChecked();
    // Goals start empty or pre-filled: make sure Travel, and only Travel, is picked.
    for (const goal of ["INTERVIEW", "BUSINESS", "DAILY", "ACADEMIC"]) {
      if (await page.getByTestId(`goal-${goal}`).isChecked()) await page.getByTestId(`goal-${goal}`).evaluate((el) => (el as HTMLInputElement).click());
    }
    if (!(await page.getByTestId("goal-TRAVEL").isChecked())) await page.getByText("Travel", { exact: true }).click();
    await expect(page.getByTestId("goal-TRAVEL")).toBeChecked();
    await page.getByTestId("onboarding-next").click();
    await page.getByText("10 minutes", { exact: true }).click();
    await page.getByTestId("onboarding-finish").click();
    await expect(page).toHaveURL(/\/practice$/);
  });

  await test.step("pick a scenario and enter the room", async () => {
    await expect(page.getByRole("heading", { name: "What do you want to practise?" })).toBeVisible();
    await expect(page.getByTestId("scenario-row").first()).toBeVisible();
    await page.getByTestId("scenario-row").first().click();
    await expect(page).toHaveURL(/\/room\/[0-9A-Z]{26}$/);
    sessionId = page.url().split("/").pop()!;
  });

  await test.step("talk to the stub tutor by typing", async () => {
    await page.getByTestId("join-typing").click();
    // The tutor speaks first, in Spanish, with the English gloss shown dimmed under it.
    const caption = page.getByTestId("caption");
    await expect(caption).toBeVisible();
    await expect(page.getByTestId("line-tutor").first()).toBeVisible();
    for (const line of LEARNER_LINES) {
      const box = page.getByLabel("Type your reply");
      await expect(box).toBeEnabled();
      await box.fill(line);
      await box.press("Enter");
      await expect(page.getByTestId("line-learner").filter({ hasText: line })).toBeVisible();
      // The tutor answers with its next scripted line.
      await expect(page.getByTestId("line-tutor")).not.toHaveCount(0);
    }
    await expect(page.getByTestId("line-tutor").nth(1)).toBeVisible();
  });

  await test.step("the translation switch hides the gloss", async () => {
    const gloss = page.getByTestId("caption").locator("p").nth(1);
    if (await gloss.count()) {
      await expect(gloss).toBeVisible();
      await page.getByTestId("toggle-translations").click();
      await expect(page.getByTestId("caption").locator("p")).toHaveCount(1);
      await page.getByTestId("toggle-translations").click();
    }
  });

  await test.step("end the session and read the lesson", async () => {
    await page.getByTestId("end-session").click();
    await page.getByTestId("confirm-end").click();
    await expect(page).toHaveURL(new RegExp(`/practice/${sessionId}$`));
    await expect(page.getByTestId("lesson-report")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("overall-score")).toBeVisible();
    await expect(page.getByTestId("lesson-summary")).not.toBeEmpty();
    await expect(page.getByTestId("lesson-scores")).toBeVisible();
    await expect(page.getByTestId("drills").getByRole("listitem")).toHaveCount(5);
  });

  await test.step("drills: reveal an answer and self-check it", async () => {
    await expect(page.getByTestId("drill-answer-0")).toHaveCount(0);
    await page.getByTestId("drill-reveal-0").click();
    await expect(page.getByTestId("drill-answer-0")).toBeVisible();
    await page.getByTestId("drill-right-0").click();
    await expect(page.getByTestId("drill-tally")).toContainText("1 of 5 right so far");
  });

  await test.step("save a suggested phrase to the deck", async () => {
    const first = page.getByTestId("vocab-suggestion").first();
    await expect(first).toBeVisible();
    await first.getByTestId("save-vocab").click();
    await expect(first.getByTestId("save-vocab")).toBeDisabled();
    await expect(first).toContainText("Saved");
    await page.goto("/vocab");
    await expect(page.getByTestId("vocab-row").first()).toBeVisible();
  });

  await test.step("review the card: show the answer and grade it", async () => {
    await page.goto("/review");
    const card = page.getByTestId("review-card");
    // Either the saved card is due (a new card is) or the deck is already clear.
    await card.or(page.getByTestId("review-done")).first().waitFor();
    if (await card.isVisible()) {
      await expect(page.getByTestId("review-front")).not.toBeEmpty();
      await page.getByTestId("show-answer").click();
      await expect(page.getByTestId("review-back")).toBeVisible();
      await page.getByTestId("grade-good").click();
    }
    await expect(page.getByTestId("review-done")).toBeVisible();
  });

  await test.step("progress and home reflect the session", async () => {
    await page.goto("/progress");
    await expect(page.getByTestId("activity-strip")).toBeVisible();
    await expect(page.getByTestId("score-trend")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ready when you are, Flow." })).toBeVisible();
    await expect(page.getByTestId("practice-rows").getByRole("link")).not.toHaveCount(0);
  });

  await ctx.close();
});
