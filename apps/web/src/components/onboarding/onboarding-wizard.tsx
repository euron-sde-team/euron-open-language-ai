"use client";

/**
 * First-run setup in four steps: the language you speak, the language to learn, your
 * level and goals, and a daily minutes target. Saved with PUT /api/me/profile; the last
 * step sets `onboardingComplete`.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LEVELS, type Goal, type LearnerProfile, type Level } from "@open-language/types";
import { Button, Field, NativeSelect, cn, toast } from "@open-language/ui";
import { ChoiceRow } from "@/components/common/choice-row";
import { RequireAuth } from "@/components/common/require-auth";
import { ErrorState } from "@/components/common/states";
import { Wordmark } from "@/components/common/wordmark";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { DAILY_MINUTE_CHOICES, GOAL_HINT, GOAL_LABEL, LEVEL_INFO, languageLabel, languageName, sortLanguages, stepReady, targetChoices } from "@/lib/language/languages";
import { useLanguages, useProfile } from "@/lib/practice/queries";
import { qk } from "@/lib/query-keys";
import { GOALS } from "@open-language/types";

type Step = 1 | 2 | 3 | 4;
const TITLES: Record<Step, string> = { 1: "The language you speak", 2: "The language to learn", 3: "Your level and goals", 4: "Your daily goal" };

export function OnboardingWizard() {
  return (
    <RequireAuth>
      <Wizard />
    </RequireAuth>
  );
}

function Wizard() {
  const router = useRouter();
  const qc = useQueryClient();
  const languages = useLanguages();
  const profile = useProfile();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<LearnerProfile | null>(null);
  useEffect(() => {
    if (profile.data && !form) setForm(profile.data);
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: (p: LearnerProfile) => api().profile.update({ nativeLanguage: p.nativeLanguage, targetLanguage: p.targetLanguage, level: p.level, goals: p.goals, dailyMinutesTarget: p.dailyMinutesTarget, onboardingComplete: true }),
    meta: { silent: true },
    onSuccess: (p) => {
      qc.setQueryData(qk.profile, p);
      void qc.invalidateQueries({ queryKey: ["scenarios"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      router.push("/practice");
    },
    onError: (e) => toast.error({ title: "Could not save", description: errorMessage(e) }),
  });

  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} className="mt-24" />;
  if (languages.isError) return <ErrorState error={languages.error} onRetry={() => void languages.refetch()} className="mt-24" />;
  if (!form || !languages.data)
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy>
        <p className="text-[14px] text-muted-foreground">Loading</p>
      </div>
    );

  const list = languages.data;
  const set = (patch: Partial<LearnerProfile>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const ready = stepReady(step, form);
  const toggleGoal = (g: Goal) => set({ goals: form.goals.includes(g) ? form.goals.filter((x) => x !== g) : [...form.goals, g] });

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-[640px] items-center px-4 pt-6 sm:px-6">
        <Wordmark />
      </header>
      <main id="main" className="mx-auto max-w-[640px] px-4 pb-16 pt-8 sm:px-6">
        <div className="flex gap-[3px]" aria-hidden>
          {([1, 2, 3, 4] as const).map((n) => (
            <div key={n} className={cn("h-[3px] flex-1", n <= step ? "bg-primary" : "bg-border")} />
          ))}
        </div>
        <p className="mt-4 text-[13px] text-subtle-foreground" data-testid="onboarding-step">
          Step {step} of 4
        </p>
        <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em]">{TITLES[step]}</h1>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            if (step === 1 && form.targetLanguage === form.nativeLanguage) set({ targetLanguage: targetChoices(list, form.nativeLanguage)[0]?.code ?? form.targetLanguage });
            if (step < 4) setStep((s) => (s + 1) as Step);
            else save.mutate(form);
          }}
        >
          {step === 1 ? (
            <Field label="Your native language" htmlFor="native-language" hint="Explanations and translations are shown in this language.">
              <NativeSelect id="native-language" value={form.nativeLanguage} onChange={(e) => set({ nativeLanguage: e.target.value })} data-testid="native-language">
                {sortLanguages(list).map((l) => (
                  <option key={l.code} value={l.code}>
                    {languageLabel(l)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {step === 2 ? (
            <Field label="I want to learn" htmlFor="target-language" hint={`The tutor will speak this language and gloss it in ${languageName(form.nativeLanguage, list)}.`}>
              <NativeSelect id="target-language" value={form.targetLanguage} onChange={(e) => set({ targetLanguage: e.target.value })} data-testid="target-language">
                {targetChoices(list, form.nativeLanguage).map((l) => (
                  <option key={l.code} value={l.code}>
                    {languageLabel(l)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {step === 3 ? (
            <div className="space-y-8">
              <fieldset>
                <legend className="text-sm font-medium">Your level in {languageName(form.targetLanguage, list)}</legend>
                <div role="radiogroup" aria-label="Level" className="mt-2 border-t border-border">
                  {LEVELS.map((lv) => (
                    <ChoiceRow key={lv} type="radio" name="level" checked={form.level === lv} onChange={() => set({ level: lv as Level })} title={LEVEL_INFO[lv].label} description={LEVEL_INFO[lv].description} testId={`level-${lv}`} />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium">What are you learning it for? Pick one or more.</legend>
                <div role="group" aria-label="Goals" className="mt-2 border-t border-border">
                  {GOALS.map((g) => (
                    <ChoiceRow key={g} type="checkbox" name="goals" checked={form.goals.includes(g)} onChange={() => toggleGoal(g)} title={GOAL_LABEL[g]} description={GOAL_HINT[g]} testId={`goal-${g}`} />
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 4 ? (
            <fieldset>
              <legend className="text-sm font-medium">Minutes a day you want to speak</legend>
              <div role="radiogroup" aria-label="Daily minutes" className="mt-2 border-t border-border">
                {DAILY_MINUTE_CHOICES.map((m) => (
                  <ChoiceRow key={m} type="radio" name="minutes" checked={form.dailyMinutesTarget === m} onChange={() => set({ dailyMinutesTarget: m })} title={`${m} minutes`} description={m <= 10 ? "A light daily habit" : m <= 20 ? "A steady routine" : "Serious progress"} testId={`minutes-${m}`} />
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="mt-8 flex items-center gap-3">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
                Back
              </Button>
            ) : null}
            <Button type="submit" size="lg" disabled={!ready} loading={save.isPending} data-testid={step < 4 ? "onboarding-next" : "onboarding-finish"}>
              {step < 4 ? "Continue" : "Start practising"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
