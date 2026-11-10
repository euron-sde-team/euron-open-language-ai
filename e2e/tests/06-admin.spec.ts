import { expect, test } from "@playwright/test";
import { apiLogin, as, completedPractice, DEMO, newUser, pageFor, uniq } from "../helpers";

type Tier = { id: string; name: string; monthlySessions: number | null };
type Scenario = { id: string; title: string; isActive: boolean };

test("an admin opens the console, sees practice sessions, and edits a quota tier", async ({ browser, request }) => {
  const admin = await apiLogin(request, DEMO.admin);
  // At least one practice session exists whatever else ran before.
  await completedPractice(request, await newUser(request));
  // A throwaway tier, so the deployment's real tiers are never touched.
  const name = uniq("tier");
  const tiers = await as<Tier[]>(request, admin, "POST", "/admin/tiers", { name, monthlySessions: 3, monthlyVoiceMinutes: 30, maxSessionMinutes: 15, isDefault: false });
  const tier = tiers.find((t) => t.name === name)!;
  const page = await pageFor(browser, admin, "/admin");

  try {
    await test.step("the overview opens", async () => {
      await expect(page.getByTestId("admin-overview")).toBeVisible();
    });

    await test.step("the practice list has rows and shows metadata only", async () => {
      await page.getByTestId("admin-nav-practice").click();
      await expect(page).toHaveURL(/\/admin\/practice/);
      await expect(page.locator('[data-testid^="practice-row-"]').first()).toBeVisible();
      await expect(page.getByTestId("admin-practice")).not.toContainText("Hola");
    });

    await test.step("change a tier's monthly sessions and see it saved", async () => {
      await page.goto("/admin/quotas");
      const row = page.getByTestId(`tier-row-${name}`);
      await expect(row).toContainText("3");
      await row.click();
      const dialog = page.getByTestId("tier-dialog");
      await dialog.getByTestId("tier-sessions").fill("7");
      await dialog.getByTestId("tier-save").click();
      await expect(page.getByTestId("toast-success").filter({ hasText: "Tier saved" })).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId(`tier-row-${name}`).getByRole("cell").nth(1)).toHaveText("7");
      const saved = (await as<Tier[]>(request, admin, "GET", "/admin/tiers")).find((t) => t.id === tier.id);
      expect(saved?.monthlySessions).toBe(7);
    });
  } finally {
    await as(request, admin, "DELETE", `/admin/tiers/${tier.id}`);
    await page.context().close();
  }
});

test("an admin creates a scenario, learners see it, hiding it removes it, and the audit log records it", async ({ browser, request }) => {
  const admin = await apiLogin(request, DEMO.admin);
  const learner = await newUser(request);
  await as(request, learner, "PUT", "/me/profile", { nativeLanguage: "en", targetLanguage: "es", level: "A2", goals: ["TRAVEL"], dailyMinutesTarget: 10, onboardingComplete: true });
  const title = uniq("Market stall ");
  const page = await pageFor(browser, admin, "/admin/scenarios");
  let id = "";

  try {
    await test.step("add a scenario in the dialog", async () => {
      await expect(page.getByTestId("admin-scenarios")).toBeVisible();
      await page.getByTestId("scenario-add").click();
      const dialog = page.getByTestId("scenario-dialog");
      await expect(dialog.getByTestId("scenario-save")).toBeDisabled();
      await dialog.getByTestId("scenario-title").fill(title);
      await dialog.getByTestId("scenario-description").fill("Haggle politely over the price of fruit.");
      await dialog.getByTestId("scenario-level-min").selectOption("A1");
      await dialog.getByTestId("scenario-level-max").selectOption("B1");
      await dialog.getByText("Travel", { exact: true }).click();
      await dialog.getByTestId("scenario-prompt").fill("You sell fruit at a market stall. Quote a price, let the customer bargain, and agree a fair price.");
      await dialog.getByTestId("scenario-save").click();
      await expect(page.getByTestId("toast-success").filter({ hasText: "Scenario added" })).toBeVisible();
      await expect(page.getByTestId(`scenario-row-${title}`)).toBeVisible();
      const list = await as<Scenario[]>(request, admin, "GET", "/admin/scenarios");
      id = list.find((s) => s.title === title)!.id;
      expect(id).toBeTruthy();
    });

    await test.step("learners see it on the practice screen", async () => {
      const list = await as<Scenario[]>(request, learner, "GET", "/scenarios");
      expect(list.some((s) => s.id === id)).toBe(true);
      // The staff-only prompt is never sent to learners.
      expect(JSON.stringify(list)).not.toContain("market stall. Quote a price");
    });

    await test.step("hide it from learners", async () => {
      await page.getByTestId(`scenario-menu-${id}`).click();
      await page.getByRole("menuitem", { name: "Hide from learners" }).click();
      await expect(page.getByTestId("toast-success").filter({ hasText: "hidden from learners" })).toBeVisible();
      const list = await as<Scenario[]>(request, learner, "GET", "/scenarios");
      expect(list.some((s) => s.id === id)).toBe(false);
    });

    await test.step("the audit log has the changes", async () => {
      await page.goto("/admin/audit?group=scenario");
      await expect(page.getByTestId("audit-list")).toBeVisible();
      await expect(page.getByTestId("audit-list").getByRole("listitem").first()).toContainText(/scenario/i);
    });
  } finally {
    if (id) await as(request, admin, "DELETE", `/admin/scenarios/${id}`);
    await page.context().close();
  }
});

test("a normal account gets the forbidden page at /admin", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/admin");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  await expect(page.getByText("This area is for admins")).toBeVisible();
  await page.context().close();
});
