"use client";

/**
 * Settings: what you are learning (languages, level, goals, daily target), the voice the
 * tutor speaks with, how the app looks, and the account (profile, security, your data).
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GOALS, LEVELS, type LearnerProfile, type Preferences } from "@open-language/types";
import { Button, Input, NativeSelect, Skeleton, toast } from "@open-language/ui";
import { PrivacySection } from "@/components/account/privacy-section";
import { SecuritySection } from "@/components/account/security-section";
import { PageBar } from "@/components/app/app-shell";
import { ChoiceRow } from "@/components/common/choice-row";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { DAILY_MINUTE_CHOICES, GOAL_LABEL, LEVEL_INFO, languageLabel, sortLanguages, targetChoices } from "@/lib/language/languages";
import { useLanguages, usePreferences, useProfile, useRealtimeModels, useUsage } from "@/lib/practice/queries";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { useTheme, type ThemePref } from "@/lib/stores/theme";
import { effectiveModel, effectiveVoice, modelPatch, voiceLabel } from "./settings-lib";

type Tab = "learning" | "voice" | "appearance" | "account";
const TABS: { value: Tab; label: string }[] = [
  { value: "learning", label: "Learning" },
  { value: "voice", label: "Voice" },
  { value: "appearance", label: "Appearance" },
  { value: "account", label: "Account" },
];

function Row({ title, description, htmlFor, children, testId }: { title: string; description?: React.ReactNode; htmlFor?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[14.5px] font-medium">
            {title}
          </label>
        ) : (
          <p className="text-[14.5px] font-medium">{title}</p>
        )}
        {description ? <p className="mt-0.5 max-w-md text-[13.5px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Saves a preference change, showing it at once and rolling back if the server says no. */
function usePrefsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Preferences>) => api().me.updatePreferences(patch),
    meta: { silent: true },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.preferences });
      const prev = qc.getQueryData<Preferences>(qk.preferences);
      qc.setQueryData<Preferences>(qk.preferences, (p) => (p ? { ...p, ...patch } : p));
      return { prev };
    },
    onSuccess: (p) => qc.setQueryData(qk.preferences, p),
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.preferences, ctx.prev);
      toast.error({ title: errorMessage(e) });
    },
  });
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-6 border-b border-border py-5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-10 w-48" />
        </div>
      ))}
    </div>
  );
}

// ─── Learning ───────────────────────────────────────────────────────────────

function LearningProfile() {
  const qc = useQueryClient();
  const profile = useProfile();
  const languages = useLanguages();
  const [form, setForm] = useState<LearnerProfile | null>(null);
  useEffect(() => {
    if (profile.data) setForm(profile.data);
  }, [profile.data]);
  const save = useMutation({
    mutationFn: (p: LearnerProfile) => api().profile.update({ nativeLanguage: p.nativeLanguage, targetLanguage: p.targetLanguage, level: p.level, goals: p.goals, dailyMinutesTarget: p.dailyMinutesTarget }),
    meta: { silent: true },
    onSuccess: (p) => {
      qc.setQueryData(qk.profile, p);
      void qc.invalidateQueries({ queryKey: ["scenarios"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success({ title: "Learning settings saved" });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  if (profile.isError && !profile.data) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} compact className="py-5" />;
  if (!form || !languages.data) return <RowsSkeleton rows={5} />;
  const list = languages.data;
  const set = (patch: Partial<LearnerProfile>) => setForm({ ...form, ...patch });
  const dirty = JSON.stringify(form) !== JSON.stringify(profile.data);
  const valid = form.nativeLanguage !== form.targetLanguage && form.goals.length > 0;
  return (
    <form
      data-testid="settings-learning"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && dirty) save.mutate(form);
      }}
    >
      <Row title="I speak" htmlFor="pref-native" description="Explanations and translations appear in this language.">
        <NativeSelect id="pref-native" value={form.nativeLanguage} onChange={(e) => set({ nativeLanguage: e.target.value })} className="w-64" data-testid="pref-native">
          {sortLanguages(list).map((l) => (
            <option key={l.code} value={l.code}>
              {languageLabel(l)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row title="I am learning" htmlFor="pref-target" description="Changing it starts fresh scenario suggestions; your saved words stay.">
        <NativeSelect id="pref-target" value={form.targetLanguage} onChange={(e) => set({ targetLanguage: e.target.value })} className="w-64" data-testid="pref-target">
          {targetChoices(list, form.nativeLanguage).map((l) => (
            <option key={l.code} value={l.code}>
              {languageLabel(l)}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row title="Level" htmlFor="pref-level" description="Sets how fast and how simply the tutor speaks.">
        <NativeSelect id="pref-level" value={form.level} onChange={(e) => set({ level: e.target.value as LearnerProfile["level"] })} className="w-64" data-testid="pref-level">
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {LEVEL_INFO[lv].label}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row title="Daily goal" htmlFor="pref-minutes" description="Minutes of speaking a day.">
        <NativeSelect id="pref-minutes" value={String(form.dailyMinutesTarget)} onChange={(e) => set({ dailyMinutesTarget: Number(e.target.value) })} className="w-64" data-testid="pref-minutes">
          {[...new Set([...DAILY_MINUTE_CHOICES, form.dailyMinutesTarget])].sort((x, y) => x - y).map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </NativeSelect>
      </Row>
      <fieldset className="border-b border-border py-5">
        <legend className="text-[14.5px] font-medium">Goals</legend>
        <p className="mt-0.5 max-w-md text-[13.5px] text-muted-foreground">Scenarios that fit your goals are suggested first.</p>
        <div className="mt-2 max-w-md border-t border-border" role="group" aria-label="Goals">
          {GOALS.map((g) => (
            <ChoiceRow key={g} type="checkbox" name="goals" checked={form.goals.includes(g)} onChange={() => set({ goals: form.goals.includes(g) ? form.goals.filter((x) => x !== g) : [...form.goals, g] })} title={GOAL_LABEL[g]} />
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3 py-5">
        <Button type="submit" disabled={!dirty || !valid} loading={save.isPending} data-testid="learning-save">
          Save
        </Button>
        {!valid ? <p className="text-[13px] text-subtle-foreground">Pick a different language to learn and at least one goal.</p> : null}
      </div>
    </form>
  );
}

function VoicePreferences() {
  const prefs = usePreferences();
  const models = useRealtimeModels();
  const usage = useUsage();
  const meta = useAppMeta();
  const save = usePrefsMutation();
  const p = prefs.data;
  if (prefs.isError && !p) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} compact className="py-5" />;
  if (!p || models.isPending) return <RowsSkeleton rows={2} />;
  const list = models.data ?? [];
  const model = effectiveModel(list, p);
  const voice = effectiveVoice(model, p.voice);
  const fallback = list.find((m) => m.isDefault) ?? list[0];
  const tutor = meta.data?.tutorName ?? "The tutor";
  const u = usage.data;

  return (
    <div data-testid="settings-voice">
      <Row title="Voice model" htmlFor="pref-model" description="Runs the live conversation.">
        {list.length ? (
          <NativeSelect
            id="pref-model"
            value={p.defaultRealtimeModelId && list.some((m) => m.id === p.defaultRealtimeModelId) ? p.defaultRealtimeModelId : ""}
            onChange={(e) => save.mutate(modelPatch(list, e.target.value || null, p.voice))}
            className="w-64"
            data-testid="pref-model"
          >
            <option value="">{fallback ? `The default (${fallback.displayName})` : "The default"}</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No voice models are set up yet.</p>
        )}
      </Row>
      {model && model.voices.length ? (
        <Row title="Voice" htmlFor="pref-voice" description={`How ${tutor} sounds. The voices offered by ${model.displayName}.`}>
          <NativeSelect id="pref-voice" value={voice} onChange={(e) => save.mutate({ voice: e.target.value })} className="w-64" data-testid="pref-voice">
            {model.voices.map((v) => (
              <option key={v} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </NativeSelect>
        </Row>
      ) : null}
      {u ? (
        <Row title="This month" description={`Resets on ${new Date(u.resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. A live session runs up to ${u.maxSessionMinutes} minutes.`} testId="settings-usage">
          <div className="text-right text-[13.5px] tabular-nums">
            <p>{u.sessions.limit === null ? `${u.sessions.used.toLocaleString()} sessions` : `${u.sessions.used.toLocaleString()} of ${u.sessions.limit.toLocaleString()} sessions`}</p>
            <p className="text-muted-foreground">
              {u.voiceMinutes.limit === null ? `${u.voiceMinutes.used.toLocaleString()} voice minutes` : `${u.voiceMinutes.used.toLocaleString()} of ${u.voiceMinutes.limit.toLocaleString()} voice minutes`}
            </p>
          </div>
        </Row>
      ) : null}
    </div>
  );
}

// ─── Appearance ─────────────────────────────────────────────────────────────

function Appearance() {
  const { pref, setPref } = useTheme();
  return (
    <div data-testid="settings-appearance">
      <Row title="Theme" htmlFor="pref-theme" description="System follows your device's light or dark setting. Saved on this device only.">
        <NativeSelect id="pref-theme" value={pref} onChange={(e) => setPref(e.target.value as ThemePref)} className="w-40" data-testid="pref-theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </NativeSelect>
      </Row>
    </div>
  );
}

// ─── Account ────────────────────────────────────────────────────────────────

function Profile() {
  const me = useMe();
  const { setUser } = useAuth();
  const [name, setName] = useState(me.displayName);
  useEffect(() => setName(me.displayName), [me.displayName]);
  const save = useMutation({
    mutationFn: () => api().users.updateMe({ displayName: name.trim() }),
    meta: { silent: true },
    onSuccess: (u) => {
      setUser(u);
      toast.success({ title: "Name saved" });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  const dirty = !!name.trim() && name.trim() !== me.displayName;
  return (
    <form
      className="border-b border-border pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate();
      }}
      data-testid="settings-profile"
    >
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em]">Profile</h2>
      <p className="mt-1 max-w-[620px] text-[14px] text-muted-foreground">
        Your name appears in the room and on your account. You sign in as <span className="text-foreground">{me.email}</span>.
      </p>
      <label htmlFor="profile-name" className="mt-5 block text-[13px] font-medium">
        Display name
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className="max-w-xs" data-testid="profile-name" />
        <Button type="submit" variant="outline" disabled={!dirty} loading={save.isPending} data-testid="profile-save">
          Save
        </Button>
      </div>
    </form>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("learning");
  return (
    <div>
      <PageBar />
      <div className="mx-auto w-full max-w-[860px] px-4 pb-20 sm:px-6">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em]">Settings</h1>
        <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} label="Settings sections" className="mt-6" />
        <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="mt-2">
          {tab === "learning" ? <LearningProfile /> : null}
          {tab === "voice" ? <VoicePreferences /> : null}
          {tab === "appearance" ? <Appearance /> : null}
          {tab === "account" ? (
            <div className="pt-6">
              <Profile />
              <div className="pt-8">
                <SecuritySection />
              </div>
              <div className="pt-10">
                <PrivacySection />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
