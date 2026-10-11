export function Kbd({ keys }: { keys: string }) {
  const parts = keys.split(/\+(?!$)/);
  return (
    <span className="kbd" aria-label={keys}>
      {parts.map((k, i) => (
        <span key={i}>{k}</span>
      ))}
    </span>
  );
}
