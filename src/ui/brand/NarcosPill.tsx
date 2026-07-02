export function NarcosPill() {
  return (
    <div
      className="inline-flex items-center gap-[11px] rounded-pill px-6 pt-[10px] pb-3 shadow-pill"
      style={{
        background: "var(--acc, #F5D400)",
        transform: "skewX(-6deg)",
      }}
    >
      <span
        className="font-anton text-[30px] text-[#111] tracking-[.05em]"
        style={{ transform: "skewX(6deg)" }}
      >
        NARCOS
      </span>
      <span
        className="font-mono text-[15px] font-bold text-narcos-red"
        style={{ transform: "skewX(6deg)" }}
      >
        sugar
      </span>
    </div>
  );
}
