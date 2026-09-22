export default function Loading() {
  return (
    <div className="p-6 md:p-8 animate-fade-in">
      <div className="h-8 w-48 rounded-lg bg-surface2/40 animate-pulse mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div
            key={i}
            className="h-32 rounded-xl bg-surface/40 animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
