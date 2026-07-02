import type { ReactNode } from "react";

type Accent = "acc" | "green" | "orange" | "red" | "cyan" | "purple" | "none";

const ACCENT: Record<Accent, string> = {
  acc: "var(--acc, #F5D400)",
  green: "#43B23C",
  orange: "#E5622A",
  red: "#E5352B",
  cyan: "#2AC7E8",
  purple: "#8557C9",
  none: "transparent",
};

const LABEL_COLOR: Record<Accent, string> = {
  acc: "#7A7A82",
  green: "#43B23C",
  orange: "#E5622A",
  red: "#E5352B",
  cyan: "#2AC7E8",
  purple: "#8557C9",
  none: "#7A7A82",
};

type Props = {
  label: string;
  accent?: Accent;
  children: ReactNode;
  footer?: ReactNode;
};

export function KpiCard({ label, accent = "none", children, footer }: Props) {
  return (
    <div
      className="bg-narcos-card border border-narcos-line"
      style={{
        padding: "var(--pad, 18px)",
        borderLeft: accent === "none" ? undefined : `3px solid ${ACCENT[accent]}`,
      }}
    >
      <div
        className="font-mono text-[10px] tracking-wideMono"
        style={{ color: LABEL_COLOR[accent] }}
      >
        {label}
      </div>
      <div className="mt-2">{children}</div>
      {footer && (
        <div className="font-mono text-[10px] text-narcos-mut3 mt-[7px]">{footer}</div>
      )}
    </div>
  );
}
