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

/** Passed as link state by "Home" links, so arriving back on the home page
 *  shows it rather than bouncing straight on to your own week again. */
export const STAY_HOME = { stay: true } as const;
