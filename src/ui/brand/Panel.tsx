import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
  padded?: boolean;
};

export function Panel({ children, className = "", as: As = "div", padded = true }: Props) {
  return (
    <As
      className={`bg-narcos-panel border border-narcos-line ${className}`}
      style={padded ? { padding: "var(--pad, 18px)" } : undefined}
    >
      {children}
    </As>
  );
}
