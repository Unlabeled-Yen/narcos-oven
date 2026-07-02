type Props = {
  color?: "green" | "orange" | "red" | "cyan" | "acc";
  blink?: boolean;
};

const COLOR: Record<NonNullable<Props["color"]>, string> = {
  green: "#43B23C",
  orange: "#E5622A",
  red: "#E5352B",
  cyan: "#2AC7E8",
  acc: "var(--acc, #F5D400)",
};

export function StatusDot({ color = "green", blink = true }: Props) {
  return (
    <span
      className="inline-block w-[7px] h-[7px] rounded-full"
      style={{
        background: COLOR[color],
        animation: blink ? "blink 1.6s infinite" : undefined,
      }}
      aria-hidden
    />
  );
}
