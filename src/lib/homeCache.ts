import { getActivePlan, type FullPlan } from './plansApi';
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

export interface HomeData {
  plan: FullPlan | null;
  lastCompleted: string | null;
  waterCount: number;
  active: ActiveSessionContext | null;
  weekSummary: WeekSummary;
  completedThisWeek: string[];
  recentPositions: number[];
}

let cached: HomeData | null = null;
let inflight: Promise<HomeData> | null = null;

export function getCachedHomeData(): HomeData | null {
  return cached;
}

export function clearHomeCache(): void {
  cached = null;
}

export function patchHomeCache(patch: Partial<HomeData>): void {
  if (!cached) return;
  cached = { ...cached, ...patch };
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
      return data;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
