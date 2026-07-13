export const RouteError = ({ reset }: { reset: () => void }) => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h1>Something went wrong</h1>
    <button onClick={reset} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
      Retry
    </button>
  </div>
);
