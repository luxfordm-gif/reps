// Letting a coach see an athlete's training, read-only.
//
// The athlete makes an invite code here and sends it; the coach types it in at
// /coach. What the coach can then read is decided entirely by the database
// (migration 0024) — these are thin calls onto its functions, plus the
// wording for the ways a code can be turned down.

import { supabase } from './supabase';

export interface CoachInvite {
  code: string;
  expires_at: string;
}

export interface LinkedCoach {
  coach_id: string;
  /** Their display name, or their email when they haven't set one. */
  name: string;
  linked_at: string;
}

export interface CoachAthlete {
  athlete_id: string;
  display_name: string | null;
  linked_at: string;
}

/** A fresh code. Any earlier unused one stops working. */
export async function createInvite(): Promise<CoachInvite> {
  const { data, error } = await supabase.rpc('create_coach_invite');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as CoachInvite;
  return { code: row.code, expires_at: row.expires_at };
}

/** The code still waiting to be used, if there is one. */
export async function getLiveInvite(): Promise<CoachInvite | null> {
  const { data, error } = await supabase
    .from('coach_invites')
    .select('code, expires_at')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CoachInvite | null) ?? null;
}

export async function listMyCoaches(): Promise<LinkedCoach[]> {
  const { data, error } = await supabase.rpc('athlete_coaches');
  if (error) throw error;
  return (data as LinkedCoach[]) ?? [];
}

/** Ends a link from either side: an athlete removing a coach, or a coach
 *  dropping an athlete. */
export async function removeLink(athleteId: string, coachId: string): Promise<void> {
  const { error } = await supabase
    .from('coach_links')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('coach_id', coachId);
  if (error) throw error;
}

/** The coach's side. Resolves to the athlete's id. */
export async function acceptInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_coach_invite', { invite_code: code });
  if (error) throw new Error(inviteErrorMessage(error.message));
  return data as string;
}

export async function listAthletes(): Promise<CoachAthlete[]> {
  const { data, error } = await supabase.rpc('coach_athletes');
  if (error) throw error;
  return (data as CoachAthlete[]) ?? [];
}

/** The database raises short tokens; these are what a person reads. */
export function inviteErrorMessage(raw: string): string {
  if (raw.includes('invite_not_found')) return "That code doesn't match an invite. Check it and try again.";
  if (raw.includes('invite_used')) return 'That code has already been used. Ask for a new one.';
  if (raw.includes('invite_expired')) return 'That code has expired. Ask for a new one.';
  if (raw.includes('invite_own')) return "That's your own code. Send it to your coach instead.";
  if (raw.includes('not_signed_in')) return 'Sign in first, then enter the code.';
  return raw;
}

/** "ABCD EFGH" — split in two so it's easy to read out. */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** The link that opens the coach area with the code filled in. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/coach?code=${encodeURIComponent(code)}`;
}
