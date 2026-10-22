export function ComingSoon({ title, milestone, body }: { title: string; milestone: string; body: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Arrives in {milestone}.</p>
        <p className="mt-1">{body}</p>
      </div>
    </section>
  );
}
