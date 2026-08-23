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
// it lives in localStorage, and is only ever removed when the write has been
// acknowledged by the server (or has failed enough times to be given up on).

import { useSyncExternalStore } from 'react';
import { supabase, currentUserId } from '../supabase';
import { isOfflineError, isReachable, query } from './net';
import { newId, readJson, writeJson } from './storage';

const OUTBOX_KEY = 'reps.outbox';
const FAILED_KEY = 'reps.outbox.failed';
const MAX_ATTEMPTS = 4;
const MAX_FAILED_KEPT = 20;
const RETRY_INTERVAL_MS = 30_000;

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
 *  — the queue replays blind, so it must not be able to touch anything else. */
export type UpdatableTable = 'plan_exercises';

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

export interface OutboxEntry {
  id: string;
  userId: string;
  queuedAt: string;
  attempts: number;
  op: OutboxOp;
}

export interface FailedEntry extends OutboxEntry {
  failedAt: string;
  reason: string;
}

export interface OutboxStatus {
  /** Writes still waiting to reach the server. */
  pending: number;
  /** Writes we gave up on after repeated server rejections. */
  failed: number;
  /** A flush is in flight right now. */
  syncing: boolean;
}

let syncing = false;
const listeners = new Set<() => void>();
let snapshot: OutboxStatus = { pending: 0, failed: 0, syncing: false };

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
  const next: OutboxStatus = {
    pending: load().length,
    failed: loadFailed().length,
    syncing,
  };
  if (
    next.pending === snapshot.pending &&
    next.failed === snapshot.failed &&
    next.syncing === snapshot.syncing
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

function giveUp(entry: OutboxEntry, reason: string): void {
  const failed = loadFailed();
  failed.push({ ...entry, failedAt: new Date().toISOString(), reason });
  writeJson(FAILED_KEY, failed.slice(-MAX_FAILED_KEPT));
  console.error('[outbox] giving up on queued write', entry.op.kind, reason);
}

/**
 * Push everything queued for the signed-in user, oldest first.
 *
 * Stops at the first entry that can't reach the server (we're still offline —
 * try again later) and keeps ordering intact. An entry the *server* rejects is
 * retried a few times across flushes and then set aside so one bad write can't
 * wedge the queue forever.
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

    for (;;) {
      const entries = load();
      const idx = entries.findIndex((e) => e.userId === userId);
      if (idx === -1) break;
      if (!isReachable()) break;
      const entry = entries[idx];
      try {
        await applyOp(entry.op, userId);
        const after = load().filter((e) => e.id !== entry.id);
        save(after);
      } catch (e) {
        if (isOfflineError(e)) break;
        const reason = e instanceof Error ? e.message : String(e);
        const after = load();
        const target = after.find((x) => x.id === entry.id);
        if (!target) break;
        target.attempts += 1;
        if (target.attempts >= MAX_ATTEMPTS) {
          giveUp(target, reason);
          save(after.filter((x) => x.id !== entry.id));
          continue;
        }
        console.warn('[outbox] write failed, will retry', entry.op.kind, reason);
        save(after);
        break;
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
