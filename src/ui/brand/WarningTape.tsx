type Props = {
  size?: "sm" | "md";
  className?: string;
};

export function WarningTape({ size = "md", className = "" }: Props) {
  const bg =
    size === "sm"
      ? "repeating-linear-gradient(45deg, var(--acc, #F5D400) 0 14px, #111 14px 28px)"
      : "repeating-linear-gradient(45deg, var(--acc, #F5D400) 0 16px, #111 16px 32px)";
  return (
    <div
      className={`h-[9px] ${className}`}
      style={{ background: bg }}
      aria-hidden
    />
  );
}
