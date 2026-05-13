import { PageHeader } from '../components/PageHeader';

interface Props {
  title: string;
  subtitle?: string;
}

export function ComingSoon({ title, subtitle }: Props) {
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
    </div>
  );
}
