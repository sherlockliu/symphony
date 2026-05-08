export function Loading() {
  return (
    <div className="grid gap-3">
      <div className="h-20 animate-pulse rounded-md border border-line bg-white" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-40 animate-pulse rounded-md border border-line bg-white" />
        <div className="h-40 animate-pulse rounded-md border border-line bg-white" />
        <div className="h-40 animate-pulse rounded-md border border-line bg-white" />
      </div>
    </div>
  );
}
