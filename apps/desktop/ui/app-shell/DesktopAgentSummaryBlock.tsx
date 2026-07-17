export function DesktopAgentSummaryBlock({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm text-slate-300">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
