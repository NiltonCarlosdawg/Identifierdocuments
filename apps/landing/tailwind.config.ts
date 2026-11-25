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
        background: token("bg"),
        foreground: token("text"),
        card: { DEFAULT: token("surface"), foreground: token("text") },
        popover: { DEFAULT: token("surface"), foreground: token("text") },
        primary: { DEFAULT: token("primary"), foreground: "#ffffff" },
        secondary: { DEFAULT: token("surface-low"), foreground: token("text") },
        muted: { DEFAULT: token("surface-low"), foreground: token("muted") },
        accent: { DEFAULT: token("surface-high"), foreground: token("text") },
        destructive: { DEFAULT: token("error"), foreground: "#ffffff" },
        border: token("border"),
        input: token("border"),
        ring: token("primary"),
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
