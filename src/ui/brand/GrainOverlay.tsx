const GRAIN_SVG = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E`;

export function GrainOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-0"
      style={{
        opacity: "calc(var(--grain, 1) * 0.05)",
        backgroundImage: `url("${GRAIN_SVG}")`,
      }}
    />
  );
}
