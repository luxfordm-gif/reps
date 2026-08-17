import { getActivePlan, getCachedActivePlan, type FullPlan } from './plansApi';
import {
  getLastCompletedTrainingDayName,
  getAnyActiveSession,
  getRecentSessionPositions,
  getThisWeekSummary,
  getCompletedDayNamesThisWeek,
  type ActiveSessionContext,
  type WeekSummary,
} from './sessionsApi';
import { getTodayWaterCount } from './waterApi';
import { currentUserIdSync } from './supabase';
import { readCache, writeCache } from './offline/storage';

export interface HomeData {
  plan: FullPlan | null;
  lastCompleted: string | null;
  waterCount: number;
  active: ActiveSessionContext | null;
  weekSummary: WeekSummary;
  completedThisWeek: string[];
  recentPositions: number[];
}

const PERSISTED_KEY = 'home';

const EMPTY_WEEK: WeekSummary = {
  workoutsDone: 0,
  bars: [[], [], [], [], [], [], []],
  dayDetails: [[], [], [], [], [], [], []],
};

let cached: HomeData | null = null;
let inflight: Promise<HomeData> | null = null;

/**
 * Home's data — from memory if this app session has already loaded it, and
 * otherwise from the copy persisted on the device. The persisted copy is what
 * lets the app open straight into a usable home screen with no signal.
 */
export function getCachedHomeData(): HomeData | null {
  if (cached) return cached;
  const persisted = readCache<HomeData>(currentUserIdSync(), PERSISTED_KEY);
  if (persisted) cached = persisted;
  return cached;
}

export function clearHomeCache(): void {
  cached = null;
}

export function patchHomeCache(patch: Partial<HomeData>): void {
  if (!cached) return;
  cached = { ...cached, ...patch };
  writeCache(currentUserIdSync(), PERSISTED_KEY, cached);
}

export async function loadHomeData(): Promise<HomeData> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const p = await getActivePlan();
      const mainDayIds = (p?.training_days ?? [])
        .filter((d) => d.name !== 'Abs')
        .map((d) => d.id);
      const [lc, w, a, ws, dn, rp] = await Promise.all([
        getLastCompletedTrainingDayName(p?.activated_at ?? null),
        getTodayWaterCount(),
        getAnyActiveSession(),
        getThisWeekSummary(),
        getCompletedDayNamesThisWeek(),
        getRecentSessionPositions(mainDayIds, 6),
      ]);
      const data: HomeData = {
        plan: p,
        lastCompleted: lc,
        waterCount: w,
        active: a,
        weekSummary: ws,
        completedThisWeek: dn,
        recentPositions: rp,
      };
      cached = data;
      writeCache(currentUserIdSync(), PERSISTED_KEY, data);
      return data;
    } catch (e) {
      // Each read already falls back to its own cache when there's no signal;
      // this is the backstop for anything else going wrong — Home still has to
      // render something rather than blanking out.
      const fallback = getCachedHomeData();
      if (fallback) return fallback;
      const plan = getCachedActivePlan();
      if (plan) {
        return {
          plan,
          lastCompleted: null,
          waterCount: 0,
          active: null,
          weekSummary: EMPTY_WEEK,
          completedThisWeek: [],
          recentPositions: [],
        };
      }
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
