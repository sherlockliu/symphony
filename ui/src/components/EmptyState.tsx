interface EmptyStateProps {
  title: string;
}

export function EmptyState({ title }: EmptyStateProps) {
  return (
    <div className="surface flex min-h-32 items-center justify-center rounded-md px-4 py-8 text-sm text-muted">
      {title}
    </div>
  );
}
