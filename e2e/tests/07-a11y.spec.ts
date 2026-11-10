import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { apiLogin, completedPractice, DEMO, newUser, pageFor, type TestUser } from "../helpers";

// Runs when @axe-core/playwright is installed (a root dev dependency); skips otherwise.
const require = createRequire(__filename);
let AxeBuilder: (new (opts: { page: Page }) => { withTags(t: string[]): { analyze(): Promise<{ violations: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[] }> } }) | null = null;
try {
  AxeBuilder = require("@axe-core/playwright").default;
} catch {
  AxeBuilder = null;
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder!({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")})`);
}

/** Switches the theme with transitions off, so axe never samples colours halfway through a fade. */
async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    if (!document.getElementById("e2e-no-motion")) {
      const style = document.createElement("style");
      style.id = "e2e-no-motion";
      style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
      document.head.appendChild(style);
    }
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Every route a learner reaches, checked in both themes. */
async function sweep(page: Page, user: TestUser, sessionId: string) {
  const routes: { path: string; ready: () => Promise<void> }[] = [
    { path: "/", ready: () => expect(page.getByRole("heading", { level: 1 })).toBeVisible() },
    { path: "/practice", ready: () => expect(page.getByTestId("scenario-row").first()).toBeVisible() },
    { path: `/practice/${sessionId}`, ready: () => expect(page.getByTestId("lesson-report")).toBeVisible() },
    { path: "/review", ready: () => expect(page.getByRole("heading", { name: "Review" }).first()).toBeVisible() },
    { path: "/progress", ready: () => expect(page.getByTestId("activity-strip")).toBeVisible() },
    { path: "/vocab", ready: () => expect(page.getByRole("heading", { name: "Vocabulary" }).first()).toBeVisible() },
    { path: "/settings", ready: () => expect(page.getByTestId("settings-learning")).toBeVisible() },
  ];
  void user;
  for (const r of routes) {
    await page.goto(r.path);
    await r.ready();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      expect(await seriousViolations(page), `${r.path} (${theme})`).toEqual([]);
    }
  }
}

test("learner pages have no serious or critical axe violations in light and dark", async ({ browser, request }) => {
  test.skip(!AxeBuilder, "@axe-core/playwright is not installed");
  const user = await newUser(request);
  const done = await completedPractice(request, user);
  const page = await pageFor(browser, user);
  await sweep(page, user, done.id);
  await page.context().close();
});

test("the onboarding wizard and the room are accessible in light and dark", async ({ browser, request }) => {
  test.skip(!AxeBuilder, "@axe-core/playwright is not installed");
  const fresh = await newUser(request);
  const page = await pageFor(browser, fresh, "/onboarding");
  await expect(page.getByRole("heading", { name: "The language you speak" })).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousViolations(page), `onboarding step 1 (${theme})`).toEqual([]);
  }
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("level-A1")).toBeAttached();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousViolations(page), `onboarding step 3 (${theme})`).toEqual([]);
  }
  await page.context().close();

  const learner = await newUser(request);
  await completedPractice(request, learner);
  const room = await pageFor(browser, learner, "/practice");
  await room.getByTestId("scenario-row").first().click();
  await expect(room).toHaveURL(/\/room\//);
  await room.getByTestId("join-typing").click();
  await expect(room.getByTestId("caption")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(room, theme);
    expect(await seriousViolations(room), `room (${theme})`).toEqual([]);
  }
  await room.context().close();
});

test("admin pages have no serious or critical axe violations in light and dark", async ({ browser, request }) => {
  test.skip(!AxeBuilder, "@axe-core/playwright is not installed");
  const admin = await apiLogin(request, DEMO.admin);
  const page = await pageFor(browser, admin, "/admin");
  for (const path of ["/admin", "/admin/users", "/admin/practice", "/admin/scenarios", "/admin/quotas", "/admin/models", "/admin/settings", "/admin/audit"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      expect(await seriousViolations(page), `${path} (${theme})`).toEqual([]);
    }
  }
  await page.context().close();
});
