"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { GOALS, LEVELS, type AdminScenario, type Goal, type Level, type ScenarioInput } from "@open-language/types";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, IconButton, Input, NativeSelect, Switch, Textarea, toast } from "@open-language/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ChoiceRow } from "@/components/common/choice-row";
import { api } from "@/lib/api";
import { adminErrorMessage } from "@/lib/admin";
import { GOAL_LABEL } from "@/lib/language/languages";
import { scenarioErrors, toScenarioInput, type ScenarioDraft } from "@/lib/language/scenarios";
import { AdminPage, DataTable, Dot, type Column } from "../shell";
import { adminMutation, ak } from "./common";

const BLANK: ScenarioDraft = { title: "", description: "", levelMin: "A1", levelMax: "C2", goals: [], promptTemplate: "", sortOrder: "", isActive: true };

const toDraft = (s: AdminScenario): ScenarioDraft => ({ title: s.title, description: s.description, levelMin: s.levelMin, levelMax: s.levelMax, goals: s.goals, promptTemplate: s.promptTemplate, sortOrder: String(s.sortOrder), isActive: s.isActive });

/** Create, edit, reorder and retire the role-play scenarios learners pick from. Every change is audited. */
export function AdminScenarios() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.scenarios, queryFn: () => api().admin.scenarios() });
  const [editing, setEditing] = useState<AdminScenario | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminScenario | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ak.scenarios });
    void qc.invalidateQueries({ queryKey: ["scenarios"] });
    void qc.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
  const del = useMutation({
    mutationFn: (id: string) => api().admin.deleteScenario(id),
    ...adminMutation(),
    onSuccess: () => {
      refresh();
      toast.success({ title: "Scenario deleted" });
    },
  });
  const toggle = useMutation({
    mutationFn: (s: AdminScenario) => api().admin.updateScenario(s.id, { ...toScenarioInput(toDraft(s)), isActive: !s.isActive }),
    ...adminMutation(),
    onSuccess: (_r, s) => {
      refresh();
      toast.success({ title: s.isActive ? "Scenario hidden from learners" : "Scenario shown to learners" });
    },
  });

  const columns = useMemo<Column<AdminScenario>[]>(
    () => [
      {
        key: "title",
        header: "Scenario",
        cell: (s) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{s.title}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">{s.description}</p>
          </div>
        ),
        sortValue: (s) => s.title,
        className: "max-w-[260px] sm:max-w-[420px]",
      },
      { key: "levels", header: "Levels", cell: (s) => <span className="text-muted-foreground">{s.levelMin === s.levelMax ? s.levelMin : `${s.levelMin} to ${s.levelMax}`}</span>, hideBelow: "sm" },
      { key: "goals", header: "Goals", cell: (s) => <span className="text-muted-foreground">{s.goals.map((g) => GOAL_LABEL[g]).join(", ") || "Any"}</span>, hideBelow: "lg" },
      {
        key: "active",
        header: "Shown",
        cell: (s) => (
          <span className="inline-flex items-center gap-1.5 text-[13.5px]">
            <Dot tone={s.isActive ? "success" : "muted"} />
            {s.isActive ? "Shown" : "Hidden"}
          </span>
        ),
        sortValue: (s) => (s.isActive ? 0 : 1),
      },
      { key: "order", header: "Order", align: "right", cell: (s) => s.sortOrder, sortValue: (s) => s.sortOrder, hideBelow: "md" },
      {
        key: "menu",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        className: "w-10",
        cell: (s) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${s.title}`} size="sm" data-testid={`scenario-menu-${s.id}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(s)}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggle.mutate(s)}>{s.isActive ? "Hide from learners" : "Show to learners"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleting(s)} className="text-danger">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <AdminPage
      title="Scenarios"
      description="The role-plays learners pick from. The prompt is staff-only: learners see the title and description, and the tutor reads the prompt. Changes are recorded in the audit log."
      actions={
        <Button onClick={() => setEditing("new")} data-testid="scenario-add">
          Add scenario
        </Button>
      }
      testId="admin-scenarios"
    >
      <DataTable
        caption="Scenarios"
        rows={q.data ?? []}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => setEditing(s)}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeletonRows={5}
        empty={{ title: "No scenarios yet.", description: "Learners can still start a free conversation." }}
        rowTestId={(s) => `scenario-row-${s.title}`}
        testId="scenarios-table"
      />
      <ScenarioDialog value={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description="Past sessions that used it keep their title. Learners can no longer start it. To keep it but hide it, use Hide from learners instead."
        confirmLabel="Delete scenario"
        destructive
        onConfirm={() => del.mutateAsync(deleting!.id)}
      />
    </AdminPage>
  );
}

function ScenarioDialog({ value, onClose, onSaved }: { value: AdminScenario | "new" | null; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const existing = value && value !== "new" ? value : null;
  const [d, setD] = useState<ScenarioDraft>(BLANK);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setD(existing ? toDraft(existing) : BLANK);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs = scenarioErrors(d);
  const ok = Object.keys(errs).length === 0;
  const save = useMutation({
    mutationFn: () => {
      const body: ScenarioInput = toScenarioInput(d);
      return existing ? api().admin.updateScenario(existing.id, body) : api().admin.createScenario(body);
    },
    ...adminMutation({ inline: true }),
    onError: (e) => setError(adminErrorMessage(e)),
    onSuccess: () => {
      onSaved();
      toast.success({ title: existing ? "Scenario saved" : "Scenario added" });
      onClose();
    },
  });
  const toggleGoal = (g: Goal) => setD((x) => ({ ...x, goals: x.goals.includes(g) ? x.goals.filter((y) => y !== g) : [...x.goals, g] }));
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="lg" data-testid="scenario-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.title}` : "Add a scenario"}</DialogTitle>
            <DialogDescription>Learners see the title and description. The tutor follows the prompt.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Title" htmlFor={`${id}-title`} error={d.title ? errs.title : undefined}>
              <Input id={`${id}-title`} value={d.title} maxLength={80} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} data-testid="scenario-title" />
            </Field>
            <Field label="Description" htmlFor={`${id}-desc`} error={d.description ? errs.description : undefined} hint="One or two sentences on the card.">
              <Textarea id={`${id}-desc`} rows={2} value={d.description} maxLength={300} onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))} data-testid="scenario-description" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Lowest level" htmlFor={`${id}-min`} error={errs.levelMax}>
                <NativeSelect id={`${id}-min`} value={d.levelMin} onChange={(e) => setD((x) => ({ ...x, levelMin: e.target.value as Level }))} data-testid="scenario-level-min">
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Highest level" htmlFor={`${id}-max`}>
                <NativeSelect id={`${id}-max`} value={d.levelMax} onChange={(e) => setD((x) => ({ ...x, levelMax: e.target.value as Level }))} data-testid="scenario-level-max">
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Order" htmlFor={`${id}-order`} error={errs.sortOrder} hint="Lower comes first.">
                <Input id={`${id}-order`} inputMode="numeric" value={d.sortOrder} placeholder="Last" onChange={(e) => setD((x) => ({ ...x, sortOrder: e.target.value }))} data-testid="scenario-order" />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Goals it suits</legend>
              <div role="group" aria-label="Goals" className="mt-1 border-t border-border">
                {GOALS.map((g) => (
                  <ChoiceRow key={g} type="checkbox" name="goals" checked={d.goals.includes(g)} onChange={() => toggleGoal(g)} title={GOAL_LABEL[g]} testId={`scenario-goal-${g}`} />
                ))}
              </div>
              {errs.goals ? (
                <p role="alert" className="mt-1 text-xs font-medium text-danger">
                  {errs.goals}
                </p>
              ) : null}
            </fieldset>
            <Field label="Prompt" htmlFor={`${id}-prompt`} error={d.promptTemplate ? errs.promptTemplate : undefined} hint="What the tutor plays and how it should steer the conversation. Write it in English; the tutor speaks the learner's target language.">
              <Textarea id={`${id}-prompt`} rows={7} value={d.promptTemplate} maxLength={4000} onChange={(e) => setD((x) => ({ ...x, promptTemplate: e.target.value }))} placeholder="You are a border officer at an airport. Ask the traveller why they are visiting, how long they will stay and where they will sleep." data-testid="scenario-prompt" />
            </Field>
            <label className="flex items-center justify-between gap-4 border-t border-border pt-4 text-[14px]">
              <span>
                <span className="font-medium">Shown to learners</span>
                <span className="block text-[13px] text-muted-foreground">Hidden scenarios stay here but cannot be started.</span>
              </span>
              <Switch checked={d.isActive} onCheckedChange={(v) => setD((x) => ({ ...x, isActive: v }))} data-testid="scenario-active" />
            </label>
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok} loading={save.isPending} data-testid="scenario-save">
              {existing ? "Save" : "Add scenario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
