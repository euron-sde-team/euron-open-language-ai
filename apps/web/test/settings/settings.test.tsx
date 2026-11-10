import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-language/ui";
import type { AppMeta, LanguageOption, LearnerProfile, LearnerProfilePatch, Preferences, RealtimeModelOption, Usage } from "@open-language/types";

const me = {
  preferences: vi.fn<() => Promise<Preferences>>(),
  updatePreferences: vi.fn<(b: Partial<Preferences>) => Promise<Preferences>>(),
  realtimeModels: vi.fn<() => Promise<RealtimeModelOption[]>>(),
  usage: vi.fn<() => Promise<Usage>>(),
};
const profile = { get: vi.fn<() => Promise<LearnerProfile>>(), update: vi.fn<(b: LearnerProfilePatch) => Promise<LearnerProfile>>() };
const languages = { list: vi.fn<() => Promise<LanguageOption[]>>() };
const meta = { get: vi.fn<() => Promise<Partial<AppMeta>>>() };
vi.mock("@/lib/api", () => ({ api: () => ({ me, profile, languages, meta }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams() }));

import { SettingsView } from "@/components/settings/settings-view";
import { effectiveModel, effectiveVoice, modelPatch } from "@/components/settings/settings-lib";

const models: RealtimeModelOption[] = [
  { id: "m1", displayName: "OpenAI Realtime", description: "", provider: "openai", voices: ["alloy", "verse"], isDefault: true },
  { id: "m2", displayName: "Gemini Live", description: "", provider: "gemini", voices: ["Puck", "Kore"], isDefault: false },
];
const prefs: Preferences = { voice: "verse", defaultRealtimeModelId: null };
const base: LearnerProfile = { nativeLanguage: "en", targetLanguage: "es", level: "B1", goals: ["TRAVEL"], dailyMinutesTarget: 15, onboardingComplete: true };
const langs: LanguageOption[] = [
  { code: "en", name: "English", nativeName: "English", teachable: true },
  { code: "es", name: "Spanish", nativeName: "Español", teachable: true },
  { code: "fr", name: "French", nativeName: "Français", teachable: true },
  { code: "ur", name: "Urdu", nativeName: "اردو", teachable: false },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.preferences.mockResolvedValue(prefs);
  me.updatePreferences.mockImplementation(async (b) => ({ ...prefs, ...b }));
  me.realtimeModels.mockResolvedValue(models);
  me.usage.mockResolvedValue({ month: "2026-10", sessions: { used: 3, limit: 10 }, voiceMinutes: { used: 42, limit: null }, maxSessionMinutes: 30, resetsAt: "2026-11-01T00:00:00Z" });
  meta.get.mockResolvedValue({ tutorName: "Lingua", features: { freeConversation: true } });
  profile.get.mockResolvedValue(base);
  profile.update.mockImplementation(async (b) => ({ ...base, ...b }));
  languages.list.mockResolvedValue(langs);
});

describe("settings helpers", () => {
  it("picks the model and voice the room will use", () => {
    expect(effectiveModel(models, { defaultRealtimeModelId: null })?.id).toBe("m1");
    expect(effectiveModel(models, { defaultRealtimeModelId: "m2" })?.id).toBe("m2");
    expect(effectiveModel(models, { defaultRealtimeModelId: "gone" })?.id).toBe("m1");
    expect(effectiveModel([], { defaultRealtimeModelId: null })).toBeNull();
    expect(effectiveVoice(models[0]!, "verse")).toBe("verse");
    expect(effectiveVoice(models[1]!, "verse")).toBe("Puck");
  });
  it("moves the voice along when the new model does not offer it", () => {
    expect(modelPatch(models, "m2", "verse")).toEqual({ defaultRealtimeModelId: "m2", voice: "Puck" });
    expect(modelPatch(models, null, "alloy")).toEqual({ defaultRealtimeModelId: null });
  });
});

describe("settings page", () => {
  it("saves a changed target language and level from the Learning tab", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    const target = await screen.findByTestId("pref-target");
    expect(within(target).getAllByRole("option").map((o) => o.textContent)).toEqual(["French (Français)", "Spanish (Español)"]);
    expect(screen.getByTestId("learning-save")).toBeDisabled();
    await user.selectOptions(target, "fr");
    await user.selectOptions(screen.getByTestId("pref-level"), "B2");
    await user.click(screen.getByTestId("learning-save"));
    await waitFor(() => expect(profile.update).toHaveBeenCalledWith({ nativeLanguage: "en", targetLanguage: "fr", level: "B2", goals: ["TRAVEL"], dailyMinutesTarget: 15 }));
  });

  it("will not save with no goal picked", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    await screen.findByTestId("pref-target");
    await user.click(screen.getByRole("checkbox", { name: /Travel/ }));
    expect(screen.getByTestId("learning-save")).toBeDisabled();
  });

  it("offers the chosen model's voices and saves a model change with a voice it offers", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    await user.click(await screen.findByRole("tab", { name: "Voice" }));
    const voice = await screen.findByTestId("pref-voice");
    expect(within(voice).getAllByRole("option").map((o) => o.textContent)).toEqual(["Alloy", "Verse"]);
    expect(voice).toHaveValue("verse");
    await user.selectOptions(screen.getByTestId("pref-model"), "m2");
    await waitFor(() => expect(me.updatePreferences).toHaveBeenCalledWith({ defaultRealtimeModelId: "m2", voice: "Puck" }));
    expect(await screen.findByText("Kore")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 sessions")).toBeInTheDocument();
    expect(screen.getByText("42 voice minutes")).toBeInTheDocument();
  });
});
