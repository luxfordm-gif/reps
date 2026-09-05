import type { ReactNode } from 'react';

export type Tab = 'home' | 'performance' | 'profile';

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
    id: 'performance',
    label: 'Performance',
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
  visible?: boolean;
  /** Opens the feedback sheet. Sits apart from the tabs — it's an action, not a place. */
  onFeedback?: () => void;
}

export function BottomNav({
  active = 'home',
  onChange,
  visible = true,
  onFeedback,
}: Props) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-4 pb-6 pt-3 transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-[140%]'
      }`}
      aria-hidden={!visible}
    >
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
        {onFeedback && (
          <>
            <span className="mx-0.5 h-6 w-px shrink-0 bg-white/20" aria-hidden="true" />
            <button
              onClick={onFeedback}
              aria-label="Send feedback"
              title="Send feedback"
              className="flex shrink-0 items-center justify-center rounded-pill px-3.5 py-2.5 text-white/65 transition-colors active:bg-white/10 active:text-white"
            >
              <ChatIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M19 10.5c0 3.6-3.6 6.5-8 6.5-.9 0-1.8-.1-2.6-.35L4 18l1.1-3A6 6 0 0 1 3 10.5C3 6.9 6.6 4 11 4s8 2.9 8 6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
