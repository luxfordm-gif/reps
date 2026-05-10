import { Logo } from './Logo';

export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex h-11 items-center justify-between">
      <Logo />
      {subtitle && (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
          {subtitle}
        </div>
      )}
    </div>
  );
}
