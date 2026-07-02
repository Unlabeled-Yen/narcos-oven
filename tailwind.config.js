/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        narcos: {
          bg: "#08080A",
          panel: "#0F0F12",
          card: "#111114",
          track: "#161619",
          line: "#26262C",
          line2: "#1c1c20",
          faint: "#3a3a40",
          ink: "#F5F4EF",
          ink2: "#E7E7EA",
          ink3: "#C9C9CF",
          mut: "#8A8A93",
          mut2: "#7A7A82",
          mut3: "#6C6C74",
          acc: "#F5D400",
          red: "#E5352B",
          orange: "#E5622A",
          green: "#43B23C",
          cyan: "#2AC7E8",
          purple: "#8557C9",
          greenTint: "#0f2410",
          orangeTint: "#2a1a10",
          cyanTint: "#0d2830",
          purpleTint: "#241a35",
          redTint: "#2a1010",
          label: "#F5F1E6",
          labelDash: "#b8ae95",
        },
      },
      fontFamily: {
        anton: ["Anton", "sans-serif"],
        notoTc: ["'Noto Sans TC'", "sans-serif"],
        mono: ["'Space Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        pill: "999px",
      },
      boxShadow: {
        pill: "5px 5px 0 #E5352B, 0 0 0 2px #111",
      },
      backgroundImage: {
        "warning-tape":
          "repeating-linear-gradient(45deg, var(--acc, #F5D400) 0 16px, #111 16px 32px)",
        "warning-tape-lg":
          "repeating-linear-gradient(45deg, var(--acc, #F5D400) 0 14px, #111 14px 28px)",
      },
      letterSpacing: {
        wideMono: "0.12em",
        wideCaps: "0.2em",
      },
    },
  },
  plugins: [],
};
