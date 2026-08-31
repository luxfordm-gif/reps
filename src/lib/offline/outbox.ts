// The outbox: writes made with no (or terrible) signal, persisted on the device
// and replayed against Supabase in order once the phone can reach the server.
//
// Two rules make this safe:
//   1. Every row created offline gets its id on the device (crypto.randomUUID),
//      so replaying an insert can't create a duplicate under a different id, and
//      a set logged offline can still be edited offline before it ever syncs.
//   2. Ops replay strictly in the order they were made, so a session insert
//      always lands before the sets that reference it.
//
// The queue survives reloads, app kills and the container of the browser tab —
// it lives in localStorage, and an entry is only ever removed when the server
// has acknowledged the write, or the user has explicitly discarded it. A write
// the server keeps rejecting backs off and is surfaced in the UI; it is never
// deleted on the app's own initiative, because the only copy of a set logged in
// a gym with no signal is the one in here.

import { useSyncExternalStore } from 'react';
import { supabase, currentUserId, currentUserIdSync } from '../supabase';
import { isOfflineError, isReachable, query } from './net';
import { newId, readJson, writeJson } from './storage';
import {
  getLocalSessions,
  installEvictionPlan,
  markSetsVerified,
  pruneCaches,
} from './localWorkout';

const OUTBOX_KEY = 'reps.outbox';
const FAILED_KEY = 'reps.outbox.failed';
/** After this many rejections a write stops being retried quietly and starts
 *  asking the user for help. It is never thrown away. */
const MAX_ATTEMPTS = 4;
const RETRY_INTERVAL_MS = 30_000;
/** One-time marker: the old build deleted writes it couldn't send, so on first
 *  run we pull anything it left behind back into the queue. */
const REVIVED_KEY = 'reps.outbox.revived';
/** How long a rejected write waits before the next attempt. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000];

export interface QueuedSessionRow {
  id: string;
  training_day_id: string;
  started_at: string;
}

export interface QueuedSetRow {
  id: string;
  session_id: string;
  plan_exercise_id: string | null;
  exercise_display_name: string;
  exercise_normalized_name: string;
  set_index: number;
  drop_index: number;
  weight: number | null;
  reps: number | null;
  hold_seconds: number | null;
  completed_at: string;
}

/** Tables an offline edit may patch by primary key. Deliberately a closed list
 *  — the queue replays blind, so it must not be able to touch anything else.
 *  `plans` is here for the rotation-week switch, which is a gym-floor decision
 *  that has to work without signal like the rest of them. Row ownership is still
 *  enforced server-side by RLS. */
export type UpdatableTable = 'plan_exercises' | 'plans';

export interface QueuedSetPatch {
  weight?: number | null;
  reps?: number | null;
  hold_seconds?: number | null;
}

export type OutboxOp =
  | { kind: 'create_session'; row: QueuedSessionRow }
  | { kind: 'log_set'; row: QueuedSetRow }
  | { kind: 'update_set'; id: string; patch: QueuedSetPatch }
  | { kind: 'complete_session'; id: string; completed_at: string }
  | {
      kind: 'session_notes';
      id: string;
      patch: { feedback_for_self?: string | null; notes_to_coach?: string | null };
    }
  | { kind: 'update_row'; table: UpdatableTable; id: string; patch: Record<string, unknown> }
  | { kind: 'delete_session'; id: string }
  | { kind: 'delete_open_sessions' }
  | { kind: 'body_weight'; row: { id: string; weight_kg: number; recorded_on: string } }
  | { kind: 'delete_body_weight'; id: string }
  | { kind: 'water'; recorded_on: string; count: number };

export interface OutboxError {
  code?: string;
  message: string;
  at: string;
}

export interface OutboxEntry {
  id: string;
  userId: string;
  queuedAt: string;
  attempts: number;
  op: OutboxOp;
  /** Set by a rejection: the entry is skipped until this time. */
  nextAttemptAt?: string;
  /** Why the last attempt failed, in words a person can act on. */
  lastError?: OutboxError;
  /** Rejected enough times that the user should be told. Still retried. */
  needsAttention?: boolean;
}

export interface FailedEntry extends OutboxEntry {
  failedAt: string;
  reason: string;
}

export interface OutboxStatus {
  /** Writes still waiting to reach the server. */
  pending: number;
  /** Of those, ones waiting out a retry backoff. */
  deferred: number;
  /** Writes the server keeps rejecting — surfaced, never discarded. */
  needsAttention: number;
  /** Legacy: writes the previous build gave up on, before they're revived. */
  failed: number;
  /** A flush is in flight right now. */
  syncing: boolean;
  /** When the oldest queued write was made. */
  oldestQueuedAt: string | null;
}

let syncing = false;
const listeners = new Set<() => void>();
let snapshot: OutboxStatus = {
  pending: 0,
  deferred: 0,
  needsAttention: 0,
  failed: 0,
  syncing: false,
  oldestQueuedAt: null,
};

function load(): OutboxEntry[] {
  return readJson<OutboxEntry[]>(OUTBOX_KEY) ?? [];
}

function save(entries: OutboxEntry[]): void {
  writeJson(OUTBOX_KEY, entries);
  publish();
}

function loadFailed(): FailedEntry[] {
  return readJson<FailedEntry[]>(FAILED_KEY) ?? [];
}

function publish(): void {
  const entries = load();
  const now = new Date().toISOString();
  let oldest: string | null = null;
  let deferred = 0;
  let needsAttention = 0;
  for (const e of entries) {
    if (e.nextAttemptAt && e.nextAttemptAt > now) deferred += 1;
    if (e.needsAttention) needsAttention += 1;
    if (!oldest || e.queuedAt < oldest) oldest = e.queuedAt;
  }
  const next: OutboxStatus = {
    pending: entries.length,
    deferred,
    needsAttention,
    failed: loadFailed().length,
    syncing,
    oldestQueuedAt: oldest,
  };
  if (
    next.pending === snapshot.pending &&
    next.deferred === snapshot.deferred &&
    next.needsAttention === snapshot.needsAttention &&
    next.failed === snapshot.failed &&
    next.syncing === snapshot.syncing &&
    next.oldestQueuedAt === snapshot.oldestQueuedAt
  ) {
    return;
  }
  snapshot = next;
  for (const l of listeners) l();
}

export function subscribeOutbox(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getOutboxStatus(): OutboxStatus {
  return snapshot;
}

export function pendingCount(): number {
  return load().length;
}

/** Live queue state for components. */
export function useOutboxStatus(): OutboxStatus {
  return useSyncExternalStore(subscribeOutbox, getOutboxStatus, getOutboxStatus);
}

export function clearFailed(): void {
  writeJson(FAILED_KEY, []);
  publish();
}

/**
 * Queue a write. Collapses ops that would otherwise pile up (repeated water
 * taps, re-weighing yourself, editing a set you logged two minutes ago) so a
 * long offline session doesn't replay hundreds of redundant requests.
 */
export function enqueue(userId: string, op: OutboxOp): void {
  const entries = load();

  if (op.kind === 'update_set') {
    // Editing a set that hasn't synced yet: patch it where it sits in the queue
    // instead of queuing an update against a row the server has never seen.
    const queuedInsert = entries.find(
      (e) => e.op.kind === 'log_set' && e.op.row.id === op.id
    );
    if (queuedInsert && queuedInsert.op.kind === 'log_set') {
      queuedInsert.op.row = { ...queuedInsert.op.row, ...op.patch };
      save(entries);
      return;
    }
    const queuedUpdate = entries.find(
      (e) => e.op.kind === 'update_set' && e.op.id === op.id
    );
    if (queuedUpdate && queuedUpdate.op.kind === 'update_set') {
      queuedUpdate.op.patch = { ...queuedUpdate.op.patch, ...op.patch };
      save(entries);
      return;
    }
  }

  if (op.kind === 'complete_session') {
    // Re-queued every time a stale "in progress" row is spotted, so keep one
    // per session rather than a growing pile of identical writes.
    const existing = entries.find(
      (e) => e.op.kind === 'complete_session' && e.op.id === op.id
    );
    if (existing) return;
  }

  if (op.kind === 'update_row') {
    const existing = entries.find(
      (e) =>
        e.op.kind === 'update_row' && e.op.table === op.table && e.op.id === op.id
    );
    if (existing && existing.op.kind === 'update_row') {
      existing.op.patch = { ...existing.op.patch, ...op.patch };
      save(entries);
      return;
    }
  }

  if (op.kind === 'water') {
    // Absolute count, so the newest tap wins outright.
    const existing = entries.find(
      (e) => e.op.kind === 'water' && e.op.recorded_on === op.recorded_on
    );
    if (existing && existing.op.kind === 'water') {
      existing.op.count = op.count;
      save(entries);
      return;
    }
  }

  if (op.kind === 'body_weight') {
    // One weight per day — a re-weigh replaces the queued one.
    const existing = entries.find(
      (e) => e.op.kind === 'body_weight' && e.op.row.recorded_on === op.row.recorded_on
    );
    if (existing && existing.op.kind === 'body_weight') {
      existing.op.row = op.row;
      save(entries);
      return;
    }
  }

  if (op.kind === 'delete_body_weight') {
    const idx = entries.findIndex(
      (e) => e.op.kind === 'body_weight' && e.op.row.id === op.id
    );
    if (idx >= 0) {
      // Logged and deleted while offline — the server never needs to hear about it.
      entries.splice(idx, 1);
      save(entries);
      return;
    }
  }

  if (op.kind === 'delete_session' || op.kind === 'delete_open_sessions') {
    // Drop anything queued for a session that's being thrown away.
    const doomedSessions = new Set<string>();
    if (op.kind === 'delete_session') doomedSessions.add(op.id);
    else {
      for (const e of entries) {
        if (e.op.kind === 'create_session') doomedSessions.add(e.op.row.id);
      }
    }
    const setIds = new Set<string>();
    for (const e of entries) {
      if (e.op.kind === 'log_set' && doomedSessions.has(e.op.row.session_id)) {
        setIds.add(e.op.row.id);
      }
    }
    const kept = entries.filter((e) => {
      switch (e.op.kind) {
        case 'create_session':
          return !doomedSessions.has(e.op.row.id);
        case 'log_set':
          return !doomedSessions.has(e.op.row.session_id);
        case 'update_set':
          return !setIds.has(e.op.id);
        case 'complete_session':
        case 'session_notes':
          return !doomedSessions.has(e.op.id);
        default:
          return true;
      }
    });
    // A session that only ever existed on this device needs no server delete.
    const neverSynced =
      op.kind === 'delete_session' &&
      entries.some((e) => e.op.kind === 'create_session' && e.op.row.id === op.id);
    if (neverSynced) {
      save(kept);
      return;
    }
    kept.push({ id: newId(), userId, queuedAt: new Date().toISOString(), attempts: 0, op });
    save(kept);
    return;
  }

  entries.push({ id: newId(), userId, queuedAt: new Date().toISOString(), attempts: 0, op });
  save(entries);
}

/** Ids of rows still sitting in the queue — used to badge unsynced sets. */
export function pendingSetIds(): Set<string> {
  const ids = new Set<string>();
  for (const e of load()) {
    if (e.op.kind === 'log_set') ids.add(e.op.row.id);
    if (e.op.kind === 'update_set') ids.add(e.op.id);
  }
  return ids;
}

export function hasPendingForSession(sessionId: string): boolean {
  return load().some(
    (e) =>
      (e.op.kind === 'create_session' && e.op.row.id === sessionId) ||
      (e.op.kind === 'log_set' && e.op.row.session_id === sessionId) ||
      (e.op.kind === 'complete_session' && e.op.id === sessionId)
  );
}

async function applyOp(op: OutboxOp, userId: string): Promise<void> {
  switch (op.kind) {
    case 'create_session':
      // upsert, not insert: a replay after a response we never saw must not
      // fail on the primary key.
      await query(
        supabase
          .from('sessions')
          .upsert({ ...op.row, user_id: userId }, { onConflict: 'id' })
          .select('id'),
        { label: 'sync:create_session' }
      );
      return;
    case 'log_set':
      await query(
        supabase
          .from('logged_sets')
          .upsert({ ...op.row, user_id: userId }, { onConflict: 'id' })
          .select('id'),
        { label: 'sync:log_set' }
      );
      return;
    case 'update_set':
      await query(
        supabase.from('logged_sets').update(op.patch).eq('id', op.id).select('id'),
        { label: 'sync:update_set' }
      );
      return;
    case 'complete_session':
      await query(
        supabase
          .from('sessions')
          .update({ completed_at: op.completed_at })
          .eq('id', op.id)
          .select('id'),
        { label: 'sync:complete_session' }
      );
      return;
    case 'session_notes':
      await query(
        supabase.from('sessions').update(op.patch).eq('id', op.id).select('id'),
        { label: 'sync:session_notes' }
      );
      return;
    case 'update_row':
      await query(
        supabase.from(op.table).update(op.patch).eq('id', op.id).select('id'),
        { label: `sync:update_${op.table}` }
      );
      return;
    case 'delete_session':
      await query(supabase.from('sessions').delete().eq('id', op.id).select('id'), {
        label: 'sync:delete_session',
      });
      return;
    case 'delete_open_sessions':
      await query(
        supabase
          .from('sessions')
          .delete()
          .eq('user_id', userId)
          .is('completed_at', null)
          .select('id'),
        { label: 'sync:delete_open_sessions' }
      );
      return;
    case 'body_weight':
      await query(
        supabase
          .from('body_weights')
          .upsert(
            {
              id: op.row.id,
              user_id: userId,
              weight_kg: op.row.weight_kg,
              recorded_on: op.row.recorded_on,
            },
            { onConflict: 'user_id,recorded_on' }
          )
          .select('id'),
        { label: 'sync:body_weight' }
      );
      return;
    case 'delete_body_weight':
      await query(
        supabase.from('body_weights').delete().eq('id', op.id).select('id'),
        { label: 'sync:delete_body_weight' }
      );
      return;
    case 'water':
      await query(
        supabase
          .from('water_logs')
          .upsert(
            { user_id: userId, recorded_on: op.recorded_on, count: op.count },
            { onConflict: 'user_id,recorded_on' }
          )
          .select('recorded_on'),
        { label: 'sync:water' }
      );
      return;
  }
}

interface SupabaseErrorish {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
}

/**
 * A rejection in words.
 *
 * PostgREST errors are plain objects, not Errors, so the old
 * `String(e)` produced "[object Object]" — every failure on a user's phone was
 * undiagnosable. Read the fields we actually get.
 */
export function describeError(err: unknown): OutboxError {
  const at = new Date().toISOString();
  if (err instanceof Error) return { message: err.message, at };
  if (err && typeof err === 'object') {
    const e = err as SupabaseErrorish;
    const message =
      [e.message, e.details, e.hint].filter(Boolean).join(' · ') ||
      (e.status ? `Server error ${e.status}` : 'Unknown error');
    return { code: e.code ?? (e.status != null ? String(e.status) : undefined), message, at };
  }
  return { message: String(err), at };
}

type FailureClass = 'duplicate' | 'dependency' | 'auth' | 'other';

function classifyFailure(err: unknown): FailureClass {
  const e = (err ?? {}) as SupabaseErrorish;
  const code = e.code ?? '';
  const msg = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  // The row is already there — a replay of a write that did land. That's a
  // success as far as the queue is concerned.
  if (code === '23505' || msg.includes('duplicate key')) return 'duplicate';
  // Points at a row that isn't there yet: usually a session whose insert
  // hasn't landed.
  if (code === '23503' || msg.includes('foreign key')) return 'dependency';
  if (
    code === '42501' ||
    e.status === 401 ||
    e.status === 403 ||
    msg.includes('jwt') ||
    msg.includes('row-level security')
  ) {
    return 'auth';
  }
  return 'other';
}

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1) - 1, BACKOFF_MS.length - 1)];
}

/** The session a queued write belongs to, so its dependants can be held back
 *  when it fails rather than each burning their own attempts. */
function sessionOf(op: OutboxOp): string | null {
  switch (op.kind) {
    case 'create_session':
      return op.row.id;
    case 'log_set':
      return op.row.session_id;
    case 'complete_session':
    case 'session_notes':
    case 'delete_session':
      return op.id;
    default:
      return null;
  }
}

/**
 * A set (or a completion) whose session never reached the server: rebuild the
 * missing insert from the device mirror and put it in front.
 *
 * `applyOp`'s create_session is an upsert on id, so doing this when the session
 * actually exists is harmless. Returns false when the device has no record of
 * the session either, in which case the entry is just deferred.
 */
function repairMissingSession(
  entries: OutboxEntry[],
  entry: OutboxEntry,
  userId: string
): boolean {
  const sessionId = sessionOf(entry.op);
  if (!sessionId || entry.op.kind === 'create_session') return false;
  if (
    entries.some((e) => e.op.kind === 'create_session' && e.op.row.id === sessionId)
  ) {
    return false; // already queued — it just hasn't run yet
  }
  const local = getLocalSessions(userId).find((s) => s.id === sessionId);
  if (!local) return false;
  const idx = entries.findIndex((e) => e.id === entry.id);
  entries.splice(idx < 0 ? 0 : idx, 0, {
    id: newId(),
    userId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    op: {
      kind: 'create_session',
      row: {
        id: local.id,
        training_day_id: local.training_day_id,
        started_at: local.started_at,
      },
    },
  });
  console.warn('[outbox] rebuilt the missing session for a queued write', sessionId);
  return true;
}

/**
 * Bring back anything the previous build deleted after four rejections.
 *
 * Those entries are sets and workouts that never reached the server and were
 * only recorded in `reps.outbox.failed`, which nothing ever read. Runs once.
 */
export function reviveFailedEntries(): number {
  if (typeof window === 'undefined') return 0;
  if (readJson<string>(REVIVED_KEY)) return 0;
  const failed = loadFailed();
  writeJson(REVIVED_KEY, new Date().toISOString());
  if (failed.length === 0) return 0;
  const entries = load();
  const known = new Set(entries.map((e) => e.id));
  let revived = 0;
  for (const f of failed) {
    if (known.has(f.id)) continue;
    entries.push({
      id: f.id,
      userId: f.userId,
      queuedAt: f.queuedAt,
      attempts: 0,
      op: f.op,
      lastError: { message: f.reason, at: f.failedAt },
    });
    revived += 1;
  }
  // Keep them in order, so a session insert still precedes its sets.
  entries.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
  writeJson(FAILED_KEY, []);
  save(entries);
  if (revived > 0) console.warn('[outbox] recovered', revived, 'writes the app had given up on');
  return revived;
}

/** Everything still queued, newest last — for the sync details sheet. */
export function listOutbox(): OutboxEntry[] {
  return load();
}

/** Clear every backoff and try the lot again, now. */
export function retryAllNow(): void {
  const entries = load();
  for (const e of entries) {
    e.attempts = 0;
    delete e.nextAttemptAt;
    delete e.needsAttention;
  }
  save(entries);
  requestFlush();
}

/** Drop a single queued write. Only ever called from an explicit user action —
 *  nothing in the sync path deletes a write the server hasn't taken. */
export function discardEntry(entryId: string): void {
  save(load().filter((e) => e.id !== entryId));
}

/** One line describing a queued write, for the details sheet. */
export function describeEntry(entry: OutboxEntry): string {
  const op = entry.op;
  switch (op.kind) {
    case 'create_session':
      return 'Workout started';
    case 'log_set':
      return `Set ${op.row.set_index} · ${op.row.exercise_display_name}`;
    case 'update_set':
      return 'Edited set';
    case 'complete_session':
      return 'Workout finished';
    case 'session_notes':
      return 'Workout notes';
    case 'update_row':
      return op.table === 'plans' ? 'Plan settings' : 'Exercise settings';
    case 'delete_session':
    case 'delete_open_sessions':
      return 'Discarded workout';
    case 'body_weight':
      return `Body weight ${op.row.weight_kg} kg`;
    case 'delete_body_weight':
      return 'Deleted body weight';
    case 'water':
      return 'Water count';
  }
}

/**
 * Push everything queued for the signed-in user, oldest first.
 *
 * Stops at the first entry that can't reach the server (we're still offline —
 * try again later) and keeps ordering intact within each workout. An entry the
 * *server* rejects backs off and is tried again later; its session's other
 * writes are held back for this pass rather than each burning their own
 * attempts against the same missing row. Nothing is ever discarded: a write
 * the server won't take stays queued and is surfaced to the user instead.
 */
export async function flushOutbox(): Promise<void> {
  if (syncing) return;
  if (load().length === 0) return;
  if (!isReachable()) return;

  syncing = true;
  publish();
  try {
    const userId = await currentUserId();
    if (!userId) return;

    // Sessions whose writes are held back for the rest of this pass, and the
    // ones we've already tried to rebuild (so a repair can't loop).
    const blocked = new Set<string>();
    const repaired = new Set<string>();

    for (;;) {
      const entries = load();
      const now = new Date().toISOString();
      // Writes for one workout go in the order they were made — a set can
      // never be tried before the session it belongs to. So only the oldest
      // entry for each session is eligible, which also means a session insert
      // that's backing off holds its own sets back instead of letting them run
      // into a foreign key that can't resolve yet.
      const firstOfSession = new Map<string, string>();
      for (const e of entries) {
        const session = sessionOf(e.op);
        if (session && !firstOfSession.has(session)) firstOfSession.set(session, e.id);
      }
      const entry = entries.find((e) => {
        if (e.userId !== userId) return false;
        if (e.nextAttemptAt && e.nextAttemptAt > now) return false;
        const session = sessionOf(e.op);
        if (!session) return true;
        return firstOfSession.get(session) === e.id && !blocked.has(session);
      });
      if (!entry) break;
      if (!isReachable()) break;
      try {
        await applyOp(entry.op, userId);
        if (entry.op.kind === 'log_set') {
          // It's on the server now, so reconciliation needn't watch it.
          markSetsVerified(userId, [entry.op.row.id]);
        }
        save(load().filter((e) => e.id !== entry.id));
      } catch (e) {
        if (isOfflineError(e)) break;
        const failure = classifyFailure(e);
        const after = load();
        const target = after.find((x) => x.id === entry.id);
        if (!target) break;
        if (failure === 'duplicate') {
          // The row is already there: this write did land, we just never saw
          // the answer. Treat it as done.
          save(after.filter((x) => x.id !== entry.id));
          continue;
        }
        const session = sessionOf(target.op);
        if (failure === 'dependency' && session && !repaired.has(session)) {
          repaired.add(session);
          if (repairMissingSession(after, target, userId)) {
            // The rebuilt session insert now sits in front of this entry; try
            // again straight away rather than punishing it for a missing parent.
            save(after);
            continue;
          }
        }
        target.attempts += 1;
        target.lastError = describeError(e);
        target.nextAttemptAt = new Date(Date.now() + backoffFor(target.attempts)).toISOString();
        // A rejection the app can recover from on its own — an expired token,
        // a refresh that hasn't happened yet — gets longer to sort itself out
        // before it's put in front of the user as something to act on.
        const limit = failure === 'auth' ? MAX_ATTEMPTS * 2 : MAX_ATTEMPTS;
        if (target.attempts >= limit) target.needsAttention = true;
        save(after);
        if (session) blocked.add(session);
        console.warn(
          '[outbox] write rejected, will retry',
          target.op.kind,
          target.lastError.message
        );
      }
    }
  } finally {
    syncing = false;
    publish();
  }
}

let started = false;

/** Wire up the triggers that drain the queue: regaining signal, coming back to
 *  the app, and a slow heartbeat while anything is still pending. */
export function startOutboxSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Teach the storage layer which caches it may sacrifice when the phone runs
  // out of room, and tidy up before it comes to that.
  installEvictionPlan(currentUserIdSync);
  pruneCaches(currentUserIdSync());
  // Anything the old build deleted rather than retried comes back now.
  reviveFailedEntries();
  publish();

  const kick = () => {
    flushOutbox().catch(() => {
      // Never let a sync failure surface as an unhandled rejection.
    });
  };

  window.addEventListener('online', kick);
  window.addEventListener('focus', kick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
  window.setInterval(() => {
    if (pendingCount() > 0) kick();
  }, RETRY_INTERVAL_MS);
  kick();
}

/** Best-effort flush at a natural moment (finishing a workout, opening Home). */
export function requestFlush(): void {
  flushOutbox().catch(() => {});
}
