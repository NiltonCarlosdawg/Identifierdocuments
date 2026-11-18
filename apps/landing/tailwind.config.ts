import type { Config } from "tailwindcss";

// Colours resolve to `rgb(var(--docid-*-rgb) / <alpha-value>)` so opacity
// modifiers (bg-docid-surface/70) work. The hex vars in styles.css stay for
// raw CSS use; keep both in sync.
const token = (name: string) => `rgb(var(--docid-${name}-rgb) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        docid: {
          bg: token("bg"),
          surface: token("surface"),
          "surface-low": token("surface-low"),
          "surface-lowest": token("surface-lowest"),
          "surface-high": token("surface-high"),
          border: token("border"),
          outline: token("outline"),
          text: token("text"),
          muted: token("muted"),
          primary: token("primary"),
          "primary-soft": token("primary-soft"),
          secondary: token("secondary"),
          tertiary: token("tertiary"),
          error: token("error"),
          link: token("link"),
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Archivo", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: { tightest: "-0.035em" },
      transitionTimingFunction: { "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
