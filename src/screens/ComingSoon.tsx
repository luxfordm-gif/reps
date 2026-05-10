import { PageHeader } from '../components/PageHeader';
import { BottomNav, type Tab } from '../components/BottomNav';

interface Props {
  active: Tab;
  title: string;
  subtitle?: string;
  onTabChange: (tab: Tab) => void;
}

export function ComingSoon({ active, title, subtitle, onTabChange }: Props) {
  return (
    <div className="min-h-screen bg-paper pb-28">
      <div className="mx-auto max-w-md px-5 pt-3">
        <PageHeader title={title} />
        <div className="mt-12 rounded-card bg-paper-card p-8 text-center shadow-card">
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          <p className="mt-4 text-xs uppercase tracking-[0.12em] text-muted">
            Coming soon
          </p>
        </div>
      </div>
      <BottomNav active={active} onChange={onTabChange} />
    </div>
  );
}
