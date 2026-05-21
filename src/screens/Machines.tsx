import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmModal } from '../components/ConfirmModal';
import { BODY_PARTS } from '../lib/parseTrainingPlan';
import { toSentenceCase } from '../lib/textCase';

// Body parts are stored in sentence case in plan_exercises.body_part (the
// parser passes them through toSentenceCase before insert). Pre-compute the
// dropdown labels so the select can match a machine's existing value.
const BODY_PART_OPTIONS = BODY_PARTS.map((bp) => toSentenceCase(bp));
import {
  changeMachineUnitInPlace,
  deleteMachine,
  forkMachineForNewUnit,
  forkMachineToNew,
  listMachines,
  mergeMachines,
  renameMachineInPlace,
  setMachineBodyPart,
  type MachineRow,
} from '../lib/machinesApi';
import type { MachineUnit } from '../lib/units';
import { clearHomeCache } from '../lib/homeCache';

type SortMode = 'alpha' | 'bodyPart';
const UNITS: MachineUnit[] = ['kg', 'lb', 'pin'];

interface Props {
  onBack: () => void;
}

export function Machines({ onBack }: Props) {
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('alpha');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MachineRow | null>(null);
  const [merging, setMerging] = useState<MachineRow[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MachineRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const rows = await listMachines();
      setMachines(rows);
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load machines');
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const sorted = useMemo(() => {
    if (!machines) return null;
    const rows = [...machines];
    rows.sort((a, b) => {
      if (sort === 'bodyPart') {
        const ap = a.bodyPart ?? '￿';
        const bp = b.bodyPart ?? '￿';
        if (ap !== bp) return ap.localeCompare(bp);
      }
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
    return rows;
  }, [machines, sort]);

  const grouped = useMemo(() => {
    if (!sorted) return null;
    if (sort !== 'bodyPart') return null;
    const out: { bodyPart: string; rows: MachineRow[] }[] = [];
    for (const r of sorted) {
      const key = r.bodyPart ?? 'Other';
      const tail = out[out.length - 1];
      if (tail && tail.bodyPart === key) tail.rows.push(r);
      else out.push({ bodyPart: key, rows: [r] });
    }
    return out;
  }, [sorted, sort]);

  function toggleSelect(name: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleSave(
    machine: MachineRow,
    patch: SavePatch
  ): Promise<void> {
    setBusy(true);
    try {
      // Body part — always saved if changed.
      if (patch.bodyPartChanged) {
        await setMachineBodyPart(machine.normalizedName, patch.bodyPart);
      }
      // Name + unit may be combined; apply name first, then unit (the unit
      // operates on the post-rename normalized_name).
      let workingNormalized = machine.normalizedName;
      if (patch.nameChange) {
        if (patch.nameChange.mode === 'inPlace') {
          await renameMachineInPlace(machine.normalizedName, patch.nameChange.newName);
          workingNormalized = normalizeForDisplay(patch.nameChange.newName);
        } else {
          await forkMachineToNew(machine.normalizedName, patch.nameChange.newName);
          // Original untouched; subsequent unit change targets the new fork.
          workingNormalized = normalizeForDisplay(patch.nameChange.newName);
        }
      }
      if (patch.unitChange) {
        if (patch.unitChange.mode === 'fork') {
          // For "fork on unit change": use the original machine and create a
          // new entry with the new unit + (optionally) new name. If no name
          // was provided we use machine.displayName which would collide — we
          // generate a unique suffix.
          const forkName = patch.unitChange.newName;
          await forkMachineForNewUnit(machine.normalizedName, forkName, patch.unitChange.newUnit);
        } else {
          // 'preserve' or 'convert' update in place.
          await changeMachineUnitInPlace(
            workingNormalized,
            patch.unitChange.newUnit,
            patch.unitChange.mode
          );
        }
      }
      clearHomeCache();
      setEditing(null);
      await reload();
    } catch (e) {
      alert((e as Error)?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(rows: MachineRow[]) {
    setBusy(true);
    try {
      for (const r of rows) await deleteMachine(r.normalizedName);
      clearHomeCache();
      setConfirmDelete(null);
      setEditing(null);
      exitSelectMode();
      await reload();
    } catch (e) {
      alert((e as Error)?.message ?? 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge(survivor: MachineRow, losers: MachineRow[]) {
    setBusy(true);
    try {
      await mergeMachines(
        survivor.normalizedName,
        losers.map((r) => r.normalizedName)
      );
      clearHomeCache();
      setMerging(null);
      exitSelectMode();
      await reload();
    } catch (e) {
      alert((e as Error)?.message ?? 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="min-h-screen bg-paper pb-40">
      <div
        className="mx-auto max-w-md px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0px)' }}
      >
        <PageHeader
          title="Machines"
          onBack={selectMode ? exitSelectMode : onBack}
          rightAction={
            machines && machines.length > 0 ? (
              <button
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                className="px-3 py-2 text-sm font-semibold text-ink active:opacity-60"
              >
                {selectMode ? 'Done' : 'Select'}
              </button>
            ) : undefined
          }
        />

        <p className="mt-2 text-sm text-muted">
          Every machine you've planned or logged. Tap one to rename, change its
          unit, or remove it. Use Select to merge duplicates.
        </p>

        <div className="mt-5 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Sort by
          </div>
          <div className="flex rounded-pill bg-line p-0.5">
            <SortPill active={sort === 'alpha'} onClick={() => setSort('alpha')}>
              A–Z
            </SortPill>
            <SortPill
              active={sort === 'bodyPart'}
              onClick={() => setSort('bodyPart')}
            >
              Body part
            </SortPill>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {machines === null && (
          <div className="mt-6 text-sm text-muted">Loading…</div>
        )}

        {machines && machines.length === 0 && (
          <div className="mt-8 rounded-card bg-paper-card p-5 text-sm text-muted shadow-card">
            No machines yet. Log a workout or upload a training plan to populate
            this list.
          </div>
        )}

        {sorted && sort === 'alpha' && (
          <div className="mt-4 overflow-hidden rounded-card bg-paper-card shadow-card">
            {sorted.map((m, i) => (
              <Row
                key={m.normalizedName}
                machine={m}
                selectMode={selectMode}
                selected={selected.has(m.normalizedName)}
                onToggleSelect={() => toggleSelect(m.normalizedName)}
                onOpen={() => setEditing(m)}
                last={i === sorted.length - 1}
              />
            ))}
          </div>
        )}

        {grouped && (
          <div className="mt-4 space-y-5">
            {grouped.map((g) => (
              <div key={g.bodyPart}>
                <div className="mb-2 text-xs font-semibold tracking-[0.04em] text-muted">
                  {g.bodyPart}
                </div>
                <div className="overflow-hidden rounded-card bg-paper-card shadow-card">
                  {g.rows.map((m, i) => (
                    <Row
                      key={m.normalizedName}
                      machine={m}
                      selectMode={selectMode}
                      selected={selected.has(m.normalizedName)}
                      onToggleSelect={() => toggleSelect(m.normalizedName)}
                      onOpen={() => setEditing(m)}
                      last={i === g.rows.length - 1}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectMode && selectedCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-card px-5 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="text-sm font-semibold text-ink">
              {selectedCount} selected
            </div>
            <div className="ml-auto flex gap-2">
              <button
                disabled={selectedCount < 2}
                onClick={() => {
                  const rows = (machines ?? []).filter((m) =>
                    selected.has(m.normalizedName)
                  );
                  setMerging(rows);
                }}
                className="rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Merge…
              </button>
              <button
                onClick={() => {
                  const rows = (machines ?? []).filter((m) =>
                    selected.has(m.normalizedName)
                  );
                  setConfirmDelete(rows);
                }}
                className="rounded-pill border border-red-200 bg-paper-card px-4 py-2 text-sm font-semibold text-red-600 active:bg-red-50"
              >
                Delete…
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <MachineEditModal
          machine={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => handleSave(editing, patch)}
          onDelete={() => setConfirmDelete([editing])}
          busy={busy}
        />
      )}

      {merging && (
        <MergeMachinesModal
          machines={merging}
          onCancel={() => setMerging(null)}
          onConfirm={(survivor) =>
            handleMerge(
              survivor,
              merging.filter((m) => m.normalizedName !== survivor.normalizedName)
            )
          }
          busy={busy}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={
            confirmDelete.length === 1
              ? `Delete ${confirmDelete[0].displayName}?`
              : `Delete ${confirmDelete.length} machines?`
          }
          message={buildDeleteWarning(confirmDelete)}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function normalizeForDisplay(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildDeleteWarning(rows: MachineRow[]): string {
  const setTotal = rows.reduce((acc, r) => acc + r.setCount, 0);
  const planTotal = rows.reduce((acc, r) => acc + r.planRefCount, 0);
  const parts: string[] = [];
  if (setTotal > 0)
    parts.push(`${setTotal} logged set${setTotal === 1 ? '' : 's'}`);
  if (planTotal > 0)
    parts.push(`${planTotal} plan reference${planTotal === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'This cannot be undone.';
  return `Also deletes ${parts.join(' and ')}. This cannot be undone.`;
}

function SortPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-pill px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
        active ? 'bg-ink text-white' : 'text-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Row({
  machine,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  last,
}: {
  machine: MachineRow;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  last: boolean;
}) {
  return (
    <>
      <button
        onClick={selectMode ? onToggleSelect : onOpen}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-line/40"
      >
        {selectMode && (
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
              selected ? 'border-ink bg-ink text-white' : 'border-line'
            }`}
          >
            {selected && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6.5L5 9.5L10 3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {machine.displayName}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            {machine.bodyPart && (
              <span className="rounded-pill bg-line/60 px-2 py-0.5 font-semibold tracking-wide">
                {machine.bodyPart}
              </span>
            )}
            <span className="rounded-pill bg-line/60 px-2 py-0.5 font-semibold uppercase tracking-wider">
              {machine.unit}
            </span>
            <span>
              {machine.setCount} set{machine.setCount === 1 ? '' : 's'}
              {machine.planRefCount > 0 ? ` · ${machine.planRefCount} plan` : ''}
            </span>
          </div>
        </div>
        {!selectMode && <Chevron />}
      </button>
      {!last && <div className="ml-5 border-t border-line" />}
    </>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M7 4l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------- Edit modal ----------

interface SavePatch {
  bodyPartChanged: boolean;
  bodyPart: string | null;
  nameChange: { mode: 'inPlace' | 'fork'; newName: string } | null;
  unitChange:
    | { mode: 'preserve' | 'convert'; newUnit: MachineUnit }
    | { mode: 'fork'; newUnit: MachineUnit; newName: string }
    | null;
}

function MachineEditModal({
  machine,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  machine: MachineRow;
  onClose: () => void;
  onSave: (patch: SavePatch) => Promise<void>;
  onDelete: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(machine.displayName);
  const [bodyPart, setBodyPart] = useState<string | null>(machine.bodyPart);
  const [unit, setUnit] = useState<MachineUnit>(machine.unit);
  const [nameChoice, setNameChoice] = useState<'inPlace' | 'fork' | null>(null);
  const [unitChoice, setUnitChoice] = useState<'preserve' | 'fork' | null>(null);
  const [forkName, setForkName] = useState(machine.displayName + ' (new)');

  const nameChanged = name.trim() && name.trim() !== machine.displayName;
  const bodyPartChanged = (bodyPart ?? null) !== (machine.bodyPart ?? null);
  const unitChanged = unit !== machine.unit;

  const needsNameChoice = nameChanged && !nameChoice;
  // Unit choice always offers preserve (update history) or fork (new machine).
  const needsUnitChoice = unitChanged && !unitChoice;

  function save() {
    if (!name.trim()) return;
    const patch: SavePatch = {
      bodyPartChanged,
      bodyPart,
      nameChange: nameChanged
        ? { mode: nameChoice ?? 'inPlace', newName: name.trim() }
        : null,
      unitChange: unitChanged
        ? unitChoice === 'fork'
          ? { mode: 'fork', newUnit: unit, newName: forkName.trim() }
          : { mode: 'preserve', newUnit: unit }
        : null,
    };
    onSave(patch);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 px-0 backdrop-blur-sm sm:items-center sm:px-6"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-paper-card p-6 shadow-card sm:max-w-md sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Edit machine</h2>
        <div className="mt-4 space-y-5">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameChoice(null);
              }}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
            />
          </Field>

          <Field label="Body part">
            <select
              value={bodyPart ?? ''}
              onChange={(e) => setBodyPart(e.target.value || null)}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
            >
              <option value="">— Unset —</option>
              {BODY_PART_OPTIONS.map((bp) => (
                <option key={bp} value={bp}>
                  {bp}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Weight unit">
            <div className="flex rounded-pill bg-line p-0.5">
              {UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => {
                    setUnit(u);
                    setUnitChoice(null);
                  }}
                  className={`flex-1 rounded-pill px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                    unit === u ? 'bg-ink text-white' : 'text-muted'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </Field>

          {nameChanged && (
            <Prompt
              label="The name changed"
              question="Is this the same machine (you're fixing a typo) or a new machine going forward?"
            >
              <ChoiceRow
                selected={nameChoice === 'inPlace'}
                title="Same machine"
                subtitle="Keep all history and rename in place."
                onClick={() => setNameChoice('inPlace')}
              />
              <ChoiceRow
                selected={nameChoice === 'fork'}
                title="New machine"
                subtitle="Original keeps its name + history. A new empty machine is created."
                onClick={() => setNameChoice('fork')}
              />
            </Prompt>
          )}

          {unitChanged && (
            <Prompt
              label="The unit changed"
              question="Update this machine's history, or treat it as a new machine going forward?"
            >
              <ChoiceRow
                selected={unitChoice === 'preserve'}
                title="Update history"
                subtitle={`Past sets keep their numbers under ${unit}. (E.g. 100 ${machine.unit} becomes 100 ${unit} — the gym weight changes.)`}
                onClick={() => setUnitChoice('preserve')}
              />
              <ChoiceRow
                selected={unitChoice === 'fork'}
                title="New machine going forward"
                subtitle={`Leave the original ${machine.unit} machine + history alone. Start a fresh ${unit} machine.`}
                onClick={() => setUnitChoice('fork')}
              />
              {unitChoice === 'fork' && (
                <div className="mt-2">
                  <Field label="New machine name">
                    <input
                      value={forkName}
                      onChange={(e) => setForkName(e.target.value)}
                      className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                    />
                  </Field>
                </div>
              )}
            </Prompt>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={
                busy ||
                !name.trim() ||
                needsNameChoice ||
                needsUnitChoice ||
                (unitChoice === 'fork' && !forkName.trim())
              }
              className="flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <button
            onClick={onDelete}
            className="w-full rounded-pill border border-red-200 py-3 text-sm font-semibold text-red-600 active:bg-red-50"
          >
            Delete machine
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function Prompt({
  label,
  question,
  children,
}: {
  label: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-ink">{question}</div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function ChoiceRow({
  selected,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left ${
        selected ? 'border-ink bg-paper-card' : 'border-line bg-paper-card'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-ink bg-ink' : 'border-line'
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      <div>
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{subtitle}</div>
      </div>
    </button>
  );
}

// ---------- Merge modal ----------

function MergeMachinesModal({
  machines,
  onCancel,
  onConfirm,
  busy,
}: {
  machines: MachineRow[];
  onCancel: () => void;
  onConfirm: (survivor: MachineRow) => void;
  busy: boolean;
}) {
  const [survivorName, setSurvivorName] = useState<string>(
    machines[0]?.normalizedName ?? ''
  );
  const survivor =
    machines.find((m) => m.normalizedName === survivorName) ?? machines[0];
  const losers = machines.filter((m) => m.normalizedName !== survivor.normalizedName);
  const movedSets = losers.reduce((acc, r) => acc + r.setCount, 0);
  const movedPlans = losers.reduce((acc, r) => acc + r.planRefCount, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 px-0 backdrop-blur-sm sm:items-center sm:px-6"
      onClick={onCancel}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-paper-card p-6 shadow-card sm:max-w-md sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Merge machines</h2>
        <p className="mt-1 text-sm text-muted">
          Pick which one keeps its name. All history and plan references from the
          others will be moved over.
        </p>

        <div className="mt-4 space-y-2">
          {machines.map((m) => (
            <ChoiceRow
              key={m.normalizedName}
              selected={m.normalizedName === survivor.normalizedName}
              title={m.displayName}
              subtitle={`${m.bodyPart ?? 'Unset'} · ${m.unit} · ${m.setCount} sets · ${m.planRefCount} plan refs`}
              onClick={() => setSurvivorName(m.normalizedName)}
            />
          ))}
        </div>

        <div className="mt-4 rounded-xl bg-paper p-3 text-xs text-muted">
          {losers.length === 0 ? (
            'Select at least one other machine to merge in.'
          ) : (
            <>
              <strong className="text-ink">{movedSets}</strong>
              {' set'}
              {movedSets === 1 ? '' : 's'} and{' '}
              <strong className="text-ink">{movedPlans}</strong> plan reference
              {movedPlans === 1 ? '' : 's'} will move to{' '}
              <strong className="text-ink">{survivor.displayName}</strong>.{' '}
              {losers.length} machine{losers.length === 1 ? '' : 's'} will be
              deleted.
            </>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-line/40"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(survivor)}
            disabled={busy || losers.length === 0}
            className="flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
