import type { ReactNode } from 'react';

export type Tab = 'home' | 'workouts' | 'progress' | 'profile';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M3 9.5L11 3l8 6.5V18a1 1 0 0 1-1 1h-4v-6H9v6H4a1 1 0 0 1-1-1V9.5z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'workouts',
    label: 'Workouts',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M3 11h2m12 0h2M6 7v8m10-8v8M9 9.5v3m4-3v3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'progress',
    label: 'Progress',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M3 17l5-5 4 4 7-8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M4 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

interface Props {
  active?: Tab;
  onChange?: (tab: Tab) => void;
}

export function BottomNav({ active = 'home', onChange }: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-6 pt-3">
      <div className="mx-auto flex max-w-md items-center justify-between rounded-pill bg-ink p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange?.(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill py-2.5 text-xs font-medium transition-colors ${
                isActive ? 'bg-white text-ink' : 'text-white/65'
              }`}
            >
              {tab.icon}
              {isActive && <span>{tab.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
