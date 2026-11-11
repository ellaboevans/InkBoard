export function EditorSkeleton() {
  return (
    <div className="grid animate-pulse gap-8 lg:grid-cols-[minmax(0,1fr)_300px]" aria-busy>
      <div className="grid content-start gap-4">
        <div className="h-8 w-28 rounded-md bg-muted" />
        <div className="h-11 w-2/3 rounded-md bg-muted" />
        <div className="h-[60vh] rounded-xl bg-muted" />
      </div>
      <div className="grid content-start gap-4">
        <div className="h-40 rounded-xl bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
