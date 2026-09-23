import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { getActivePlan } from '../lib/plansApi';
import { listAlternativeNames } from '../lib/alternativesApi';
import {
  findDuplicateGroups,
  loadDismissedPairs,
  dismissPairs,
  duplicatePairKey,
  type DuplicateGroup,
} from '../lib/duplicateExercises';
import { useScrollLock } from '../lib/useScrollLock';
import { useVisualViewport } from '../lib/useVisualViewport';
import { SheetPanel } from '../components/SheetPanel';
import ExerciseName from '../components/ExerciseName';
import { BRAND_LIST_ID, BrandSuggestions } from '../components/ExerciseNameFields';
import { editedName, splitBrand } from '../lib/exerciseBrand';
import { rememberNewBrand } from '../lib/brandsApi';

type SortMode = 'alpha' | 'bodyPart';
const UNITS: MachineUnit[] = ['kg', 'lb', 'pin'];

interface Props {
  onBack: () => void;
}

/** Which slice of the list you are looking at. */
type Scope = 'all' | 'plan';

// Remembered on this device, so someone who only wants their current plan's
// machines doesn't have to ask for it every visit.
const SCOPE_KEY = 'reps.machines.scope';

function readScope(): Scope {
  try {
    return window.localStorage.getItem(SCOPE_KEY) === 'plan' ? 'plan' : 'all';
  } catch {
    return 'all';
  }
}

function writeScope(scope: Scope): void {
  try {
    window.localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // Private mode: the choice holds for this visit.
  }
}

/** The "no body part chosen" sentinel, kept out of the real names. */
const ALL_PARTS = '__all__';

export function Machines({ onBack }: Props) {
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('alpha');
  const [query, setQuery] = useState('');
  const [scope, setScopeState] = useState<Scope>(readScope);
  function setScope(next: Scope) {
    setScopeState(next);
    writeScope(next);
  }
  const [bodyPart, setBodyPart] = useState<string>(ALL_PARTS);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Normalized names the active plan actually uses. Null until it loads. */
  const [planNames, setPlanNames] = useState<Set<string> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedPairs());
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
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

  // Which machines the plan you are on right now calls for. Everything else in
  // this list is something you trained on a previous plan or logged ad hoc —
  // which is exactly where the duplicates collect.
  useEffect(() => {
    let cancelled = false;
    getActivePlan()
      .then((plan) => {
        if (cancelled) return;
        const names = new Set<string>();
        const ids: string[] = [];
        for (const day of plan?.training_days ?? []) {
          for (const ex of day.plan_exercises ?? []) {
            if (ex.normalized_name) names.add(ex.normalized_name);
            ids.push(ex.id);
          }
        }
        setPlanNames(names);
        // A machine you swap to when the planned one is taken is in the plan
        // too. Best effort: without it the list just shows the planned ones.
        listAlternativeNames(ids)
          .then((alts) => {
            if (cancelled || alts.length === 0) return;
            setPlanNames(new Set([...names, ...alts]));
          })
          .catch(() => {});
      })
      .catch(() => {
        // The filter is an extra; the list stands without it.
        if (!cancelled) setPlanNames(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Body parts present, for the filter sheet. */
  const bodyParts = useMemo(() => {
    if (!machines) return [];
    return [...new Set(machines.map((m) => m.bodyPart ?? 'Other'))].sort((a, b) =>
      a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b),
    );
  }, [machines]);

  const filtered = useMemo(() => {
    if (!machines) return null;
    const q = query.trim().toLowerCase();
    return machines.filter((m) => {
      if (scope === 'plan' && planNames && !planNames.has(m.normalizedName)) return false;
      if (bodyPart !== ALL_PARTS && (m.bodyPart ?? 'Other') !== bodyPart) return false;
      return !q || m.displayName.toLowerCase().includes(q);
    });
  }, [machines, query, scope, bodyPart, planNames]);

  const filtersOn = bodyPart !== ALL_PARTS;
  const canScope = planNames != null && planNames.size > 0;

  // Suggested over the whole list, never the filtered one: scoping to the
  // current plan hides the older half of most pairs, which is exactly the
  // half you are trying to merge away.
  const duplicates = useMemo(
    () => (machines ? findDuplicateGroups(machines, dismissed) : []),
    [machines, dismissed],
  );

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sort === 'bodyPart') {
        const ap = a.bodyPart ?? '￿';
        const bp = b.bodyPart ?? '￿';
        if (ap !== bp) return ap.localeCompare(bp);
      }
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
    return rows;
  }, [filtered, sort]);

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
        // No safe-area padding here: PageHeader's sticky bar carries it.
        className="mx-auto max-w-md px-5"
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

        <p className="mt-1 text-sm text-muted">
          {machines
            ? filtered && filtered.length !== machines.length && scope === 'plan'
              ? `${filtered.length} of ${machines.length} machines`
              : `${machines.length} machines`
            : 'Every machine you\u2019ve planned or logged'}
          {' \u00b7 '}Select to merge duplicates
        </p>

        {/* Search and one button, the same shape the records board uses — the
            two screens are both "find the movement you mean in a long list",
            and this one had a paragraph and a pair of pills instead. */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a machine"
            aria-label="Search your machines"
            className="min-w-0 flex-1 rounded-pill border border-line bg-paper-card px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Sort and filter"
            aria-haspopup="dialog"
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border active:bg-pressed ${
              filtersOn ? 'border-ink bg-ink text-white' : 'border-line bg-paper-card text-ink'
            }`}
          >
            <FilterIcon />
          </button>
        </div>

        {canScope && (
          // Out on the screen rather than in the sheet: hiding what an old
          // plan left behind is the view most people want most of the time.
          <div className="mt-2 flex rounded-pill bg-line p-0.5" role="group" aria-label="Show">
            {(
              [
                ['plan', 'In my plan'],
                ['all', 'All machines'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={`flex-1 rounded-pill px-3 py-1.5 text-xs font-semibold ${
                  scope === value ? 'bg-paper-card text-ink shadow-card' : 'text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {filtersOn && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {bodyPart !== ALL_PARTS && (
              <FilterChip onClear={() => setBodyPart(ALL_PARTS)}>{bodyPart}</FilterChip>
            )}
          </div>
        )}

        {duplicates.length > 0 && !selectMode && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => setDuplicatesOpen((v) => !v)}
              aria-expanded={duplicatesOpen}
              className="flex w-full items-center gap-2 rounded-panel px-1 py-2.5 text-left active:bg-surface"
            >
              <DupChevron open={duplicatesOpen} />
              <span className="flex-1 truncate text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Possible duplicates
              </span>
              <span className="text-xs font-semibold text-muted tabular-nums">
                {duplicates.length}
              </span>
            </button>
            {duplicatesOpen && (
              <ul className="mt-1 divide-y divide-line/60 overflow-hidden rounded-card bg-paper-card shadow-card">
                {duplicates.map((group) => (
                  <DuplicateRow
                    key={group.key}
                    group={group}
                    onMerge={() => setMerging([group.survivor, ...group.losers])}
                    onDismiss={() => setDismissed(dismissPairs(group.pairKeys))}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
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

        {sorted && sorted.length === 0 && machines && machines.length > 0 && (
          <p className="mt-8 text-center text-sm text-muted">
            {query.trim() ? `Nothing matches \u201c${query.trim()}\u201d.` : 'Nothing here.'}
          </p>
        )}

        {sorted && sorted.length > 0 && sort === 'alpha' && (
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

      {sheetOpen &&
        createPortal(
          <MachineFilterSheet
            sort={sort}
            onSort={setSort}
            bodyPart={bodyPart}
            bodyParts={bodyParts}
            onBodyPart={setBodyPart}
            onClose={() => setSheetOpen(false)}
          />,
          document.body,
        )}

      {selectMode && selectedCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper-card px-5 py-3 shadow-hairline-up"
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
                className="pressable rounded-pill border border-danger-line bg-paper-card px-4 py-2 text-sm font-semibold text-danger-strong active:bg-danger-soft"
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
          onConfirm={(survivor, losers, keptApart) => {
            // Asked and answered: a machine kept out of this merge isn't
            // suggested alongside the ones it was kept apart from again.
            if (keptApart.length > 0) {
              const keys = keptApart.flatMap((k) =>
                [survivor, ...losers].map((m) => duplicatePairKey(k.normalizedName, m.normalizedName)),
              );
              setDismissed(dismissPairs(keys));
            }
            handleMerge(survivor, losers);
          }}
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

function DupChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-muted transition-transform duration-pop ease-snap ${
        open ? 'rotate-90' : ''
      }`}
    >
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One suggested group, and the two answers to it.
 *
 * Every name on its own line with its own set count, because the counts are
 * what decide which name is worth keeping, and a group of three has no
 * sensible single count to print. Names are not truncated: the whole question
 * is which of several similar names you meant, and a clipped name is one you
 * cannot answer about.
 */
function DuplicateRow({
  group,
  onMerge,
  onDismiss,
}: {
  group: DuplicateGroup<MachineRow>;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        {/* No name is emphasised. The screen is asking whether these are the
            same movement; leading with one in bold answers the question it is
            posing, and the name with the most sets is not always the one worth
            keeping. Which name survives is chosen in the merge sheet. */}
        {[group.survivor, ...group.losers].map((machine) => (
          <div key={machine.normalizedName} className="text-sm leading-snug text-ink">
            <ExerciseName name={machine.displayName} variant="inline" />
          </div>
        ))}
        {/* Counts sit on one subordinate line rather than beside each name:
            at this width the count wrapped onto a line of its own and read as
            another name. Caption size keeps it from being mistaken for one,
            and the order matches the names above. */}
        <div className="mt-0.5 text-caption text-muted tabular-nums">
          {[group.survivor, ...group.losers].map((m) => m.setCount).join(' · ')} sets
          {group.unitDiffers && ' · different units'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-pill border border-line px-3.5 py-1.5 text-xs font-semibold text-muted active:bg-pressed"
        >
          Ignore
        </button>
        <button
          type="button"
          onClick={onMerge}
          className="rounded-pill bg-ink px-3.5 py-1.5 text-xs font-semibold text-white active:bg-ink-soft"
        >
          Merge
        </button>
      </div>
    </li>
  );
}

/**
 * Order and filter, in one sheet.
 *
 * The same shape the records board's sheet has, for the same reason: these
 * are all "show me a different slice of the same list", and a row of pills
 * per question puts six controls between you and the first machine.
 */
function MachineFilterSheet({
  sort,
  onSort,
  bodyPart,
  bodyParts,
  onBodyPart,
  onClose,
}: {
  sort: SortMode;
  onSort: (s: SortMode) => void;
  bodyPart: string;
  bodyParts: string[];
  onBodyPart: (b: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sort and filter machines"
    >
      <div
        className="sheet-in max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper-card p-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Sort and filter</h2>

        <div className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Order
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SortPill active={sort === 'alpha'} onClick={() => { onSort('alpha'); onClose(); }}>
            A–Z
          </SortPill>
          <SortPill active={sort === 'bodyPart'} onClick={() => { onSort('bodyPart'); onClose(); }}>
            Body part
          </SortPill>
        </div>

        {bodyParts.length > 1 && (
          <>
            <div className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Body part
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SortPill
                active={bodyPart === ALL_PARTS}
                onClick={() => { onBodyPart(ALL_PARTS); onClose(); }}
              >
                All
              </SortPill>
              {bodyParts.map((b) => (
                <SortPill
                  key={b}
                  active={bodyPart === b}
                  onClick={() => { onBodyPart(b); onClose(); }}
                >
                  {b}
                </SortPill>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** What's currently narrowing the list, and the way to stop it. */
function FilterChip({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 text-xs font-semibold text-white active:bg-ink-soft"
    >
      {children}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5h13M4.5 9h9M7 13.5h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
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
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-pressed"
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
            <ExerciseName name={machine.displayName} variant="inline" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
            {machine.bodyPart && (
              <span className="rounded-pill bg-surface-strong px-2 py-0.5 font-semibold tracking-wide">
                {machine.bodyPart}
              </span>
            )}
            <span className="rounded-pill bg-surface-strong px-2 py-0.5 font-semibold uppercase tracking-wider">
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
  const [initialParts] = useState(() => splitBrand(machine.displayName));
  const [movement, setMovement] = useState(initialParts.movement);
  const [brand, setBrand] = useState(initialParts.brand ?? '');
  const name = editedName(machine.displayName, movement, brand);
  const [bodyPart, setBodyPart] = useState<string | null>(machine.bodyPart);
  const [unit, setUnit] = useState<MachineUnit>(machine.unit);
  const [nameChoice, setNameChoice] = useState<'inPlace' | 'fork' | null>(null);
  const [unitChoice, setUnitChoice] = useState<'preserve' | 'fork' | null>(null);
  const [forkName, setForkName] = useState(machine.displayName + ' (new)');

  // The page behind stays put while the sheet is up, and the sheet sits in
  // whatever the keyboard has left of the viewport — renaming brings it up.
  useScrollLock();
  const viewport = useVisualViewport();

  const nameChanged = name.trim() && name.trim() !== machine.displayName.trim();
  const bodyPartChanged = (bodyPart ?? null) !== (machine.bodyPart ?? null);
  const unitChanged = unit !== machine.unit;

  const needsNameChoice = nameChanged && !nameChoice;
  // Unit choice always offers preserve (update history) or fork (new machine).
  const needsUnitChoice = unitChanged && !unitChoice;

  function save() {
    if (!name.trim()) return;
    rememberNewBrand(brand);
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
      className="fixed inset-x-0 z-50 flex items-end justify-center bg-ink/50 px-0 backdrop-blur-sm sm:items-center sm:px-6"
      style={viewport ? { top: 0, height: viewport.height } : { top: 0, bottom: 0 }}
      onClick={onClose}
    >
      <SheetPanel
        className="w-full rounded-t-card bg-paper-card shadow-card sm:max-w-md sm:rounded-card"
        header={<h2 className="text-lg font-bold tracking-tight text-ink">Edit machine</h2>}
      >
        <div className="mt-4 space-y-5">
          <Field label="Name">
            <input
              value={movement}
              onChange={(e) => {
                setMovement(e.target.value);
                setNameChoice(null);
              }}
              className="w-full rounded-control border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
            />
          </Field>

          <Field label="Brand (optional)">
            <input
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setNameChoice(null);
              }}
              placeholder="e.g. Prime"
              autoCapitalize="words"
              list={BRAND_LIST_ID}
              className="w-full rounded-control border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink placeholder:font-normal placeholder:text-muted focus:border-ink focus:outline-none"
            />
            <BrandSuggestions />
          </Field>

          <Field label="Body part">
            <select
              value={bodyPart ?? ''}
              onChange={(e) => setBodyPart(e.target.value || null)}
              className="w-full rounded-control border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
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
                      className="w-full rounded-control border border-line bg-paper px-3 py-2.5 text-sm font-semibold text-ink focus:border-ink focus:outline-none"
                    />
                  </Field>
                </div>
              )}
            </Prompt>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="pressable flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-pressed"
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
              className="pressable flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <button
            onClick={onDelete}
            className="pressable w-full rounded-pill border border-danger-line py-3 text-sm font-semibold text-danger-strong active:bg-danger-soft"
          >
            Delete machine
          </button>
        </div>
      </SheetPanel>
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
    <div className="rounded-panel border border-line bg-paper p-3">
      <div className="text-caption font-semibold uppercase tracking-[0.12em] text-muted">
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
      className={`flex w-full items-start gap-3 rounded-control border px-3 py-2.5 text-left ${
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
  onConfirm: (survivor: MachineRow, losers: MachineRow[], keptApart: MachineRow[]) => void;
  busy: boolean;
}) {
  const [survivorName, setSurvivorName] = useState<string>(
    machines[0]?.normalizedName ?? ''
  );
  // Machines in a suggested group that are really a different machine — "Prime
  // pec deck fly" beside two spellings of the plain pec deck. They stay as they
  // are while the rest merge.
  const [apart, setApart] = useState<Set<string>>(new Set());

  // No fields to type in here, so the page just needs holding still.
  useScrollLock();
  const survivor =
    machines.find((m) => m.normalizedName === survivorName) ?? machines[0];
  const others = machines.filter((m) => m.normalizedName !== survivor.normalizedName);
  const losers = others.filter((m) => !apart.has(m.normalizedName));
  const keptApart = others.filter((m) => apart.has(m.normalizedName));
  // With only two, keeping one apart leaves nothing to merge.
  const canKeepApart = machines.length > 2;

  function chooseSurvivor(name: string) {
    setSurvivorName(name);
    setApart((a) => {
      if (!a.has(name)) return a;
      const next = new Set(a);
      next.delete(name);
      return next;
    });
  }

  function toggleApart(name: string) {
    setApart((a) => {
      const next = new Set(a);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  const movedSets = losers.reduce((acc, r) => acc + r.setCount, 0);
  const movedPlans = losers.reduce((acc, r) => acc + r.planRefCount, 0);

  return (
    <div
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-ink/50 px-0 backdrop-blur-sm sm:items-center sm:px-6"
      onClick={onCancel}
    >
      <div
        className="sheet-in max-h-[92vh] w-full overflow-y-auto rounded-t-card bg-paper-card p-6 shadow-card sm:max-w-md sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold tracking-tight text-ink">Merge machines</h2>
        <p className="mt-1 text-sm text-muted">
          Pick which one keeps its name. All history and plan references from the
          others will be moved over.
          {canKeepApart && ' Keep separate leaves a machine out of the merge.'}
        </p>

        <div className="mt-4 space-y-2">
          {machines.map((m) => {
            const isSurvivor = m.normalizedName === survivor.normalizedName;
            const isApart = apart.has(m.normalizedName);
            return (
              <div key={m.normalizedName} className={`flex items-stretch gap-2 ${isApart ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <ChoiceRow
                    selected={isSurvivor}
                    title={m.displayName}
                    subtitle={
                      isApart
                        ? 'Stays a separate machine'
                        : `${m.bodyPart ?? 'Unset'} · ${m.unit} · ${m.setCount} sets · ${m.planRefCount} plan refs`
                    }
                    onClick={() => chooseSurvivor(m.normalizedName)}
                  />
                </div>
                {canKeepApart && !isSurvivor && (
                  <button
                    type="button"
                    onClick={() => toggleApart(m.normalizedName)}
                    aria-pressed={isApart}
                    className="pressable shrink-0 rounded-control border border-line bg-paper-card px-3 text-xs font-semibold text-ink active:bg-pressed"
                  >
                    {isApart ? 'Include' : 'Keep separate'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-control bg-paper p-3 text-xs text-muted">
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
              {keptApart.length > 0 && (
                <>
                  {' '}
                  <strong className="text-ink">
                    {keptApart.map((m) => m.displayName).join(', ')}
                  </strong>{' '}
                  stays as it is.
                </>
              )}
            </>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="pressable flex-1 rounded-pill border border-line bg-paper-card py-3 text-sm font-semibold text-ink active:bg-pressed"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(survivor, losers, keptApart)}
            disabled={busy || losers.length === 0}
            className="pressable flex-1 rounded-pill bg-ink py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
