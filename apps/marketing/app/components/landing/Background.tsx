export function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-slate-50 dark:bg-[#020617]">
      {/* Light gradient wash */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            'radial-gradient(circle at 20% -10%, rgba(59, 130, 246, 0.12), transparent 45%), radial-gradient(circle at 90% 10%, rgba(14, 165, 233, 0.1), transparent 35%), radial-gradient(circle at 50% 80%, rgba(236, 72, 153, 0.08), transparent 40%), #f8fafc',
        }}
      />
      {/* Dark gradient wash */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            'radial-gradient(circle at 20% -10%, rgba(59, 130, 246, 0.25), transparent 45%), radial-gradient(circle at 90% 10%, rgba(14, 165, 233, 0.2), transparent 35%), radial-gradient(circle at 50% 80%, rgba(236, 72, 153, 0.15), transparent 40%), #020617',
        }}
      />
      <div className="absolute inset-0 text-slate-300 opacity-50 dark:text-slate-600 dark:opacity-60">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 800 800"
          style={{ width: '100%', height: '100%' }}
        >
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="800" height="800" fill="url(#grid)" />
        </svg>
      </div>
    </div>
  );
}
