import { Logo } from './Logo';

export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center justify-between">
      <Logo className="h-16 w-auto" />
      {subtitle && (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
          {subtitle}
        </div>
      )}
    </div>
  );
}
