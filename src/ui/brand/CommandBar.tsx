import type { ReactNode } from "react";
import { NarcosPill } from "./NarcosPill";
import { StatusDot } from "./StatusDot";

export type NavKey =
  | "dashboard"
  | "schedule"
  | "pending"
  | "orders"
  | "menu"
  | "payout"
  | "stats"
  | "kol"
  | "capacity"
  | "labels"
  | "worksheet"
  | "manual";

export type NavItem = {
  key: NavKey;
  label: string;
  badge?: number;
};

type Props = {
  nav: NavItem[];
  active: NavKey;
  onNav?: (key: NavKey) => void;
  syncLabel?: string;
  right?: ReactNode;
};

export function CommandBar({ nav, active, onNav, syncLabel, right }: Props) {
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-5 flex-wrap px-6 py-4 border-b border-narcos-line bg-[#0C0C0E]">
      <div className="flex items-center gap-[14px] flex-wrap">
        <NarcosPill />
      </div>

      <nav className="flex gap-1 flex-wrap font-notoTc font-black text-[13px]">
        {nav.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNav?.(item.key)}
              className={`px-4 py-2 cursor-pointer ${
                isActive
                  ? "text-[#111]"
                  : "text-[#9A9AA2] hover:text-narcos-ink"
              }`}
              style={
                isActive ? { background: "var(--acc, #F5D400)" } : undefined
              }
            >
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span className="ml-1 font-mono text-[11px] text-narcos-orange">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-4 flex-wrap">
        {syncLabel && (
          <div className="flex items-center gap-[7px]">
            <StatusDot color="green" />
            <span className="font-mono text-[11px] text-narcos-mut2">
              {syncLabel}
            </span>
          </div>
        )}
        {right}
      </div>
    </div>
  );
}
