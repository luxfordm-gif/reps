import { Logo } from './Logo';

export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mt-2 flex h-11 items-center justify-between">
      <Logo className="h-[1.8rem] w-auto" />
      {subtitle && (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
          {subtitle}
        </div>
      )}
    </div>
  );
}
