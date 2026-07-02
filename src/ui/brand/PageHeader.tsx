import type { ReactNode } from "react";

type Props = {
  caption: string;
  title: string;
  right?: ReactNode;
};

export function PageHeader({ caption, title, right }: Props) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap px-6 pt-[26px] pb-[6px]">
      <div>
        <div className="font-mono text-[11px] text-narcos-mut3 tracking-wideCaps">
          {caption}
        </div>
        <h1 className="font-anton font-normal text-[48px] text-narcos-ink mt-[6px] tracking-[.03em] leading-none">
          {title}
        </h1>
      </div>
      {right}
    </div>
  );
}

type ChipProps = {
  options: { key: string; label: string }[];
  active: string;
  onChange?: (key: string) => void;
};

export function PeriodChips({ options, active, onChange }: ChipProps) {
  return (
    <div className="flex gap-[2px]">
      {options.map((opt) => {
        const isActive = opt.key === active;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange?.(opt.key)}
            className="font-mono text-[12px] px-[14px] py-2"
            style={
              isActive
                ? {
                    background: "var(--acc, #F5D400)",
                    color: "#0B0B0C",
                    fontWeight: 700,
                  }
                : { background: "#161619", color: "#7A7A82" }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
