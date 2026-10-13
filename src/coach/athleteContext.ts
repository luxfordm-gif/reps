import { useOutletContext } from 'react-router-dom';
import type { AthleteData } from '../lib/coach/coachApi';

export interface AthleteContext {
  athleteId: string;
  name: string;
  data: AthleteData;
}

/** The athlete page's data, for the screens nested under it. */
export function useAthlete(): AthleteContext {
  return useOutletContext<AthleteContext>();
}
