import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        verano: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [
    function ({ addUtilities }: { addUtilities: any }) {
      const newUtilities: Record<string, Record<string, string>> = {};
      const shades = [
        "bg", "background", "surface", "surface-low", "surface-lowest", "surface-high",
        "surface-highest", "border", "outline", "text", "muted",
        "primary", "primary-soft", "secondary", "secondary-container",
        "tertiary", "error",
      ];
      const cssVars: Record<string, string> = {
        bg: "var(--docid-bg)",
        background: "var(--docid-bg)",
        surface: "var(--docid-surface)",
        "surface-low": "var(--docid-surface-low)",
        "surface-lowest": "var(--docid-surface-lowest)",
        "surface-high": "var(--docid-surface-high)",
        "surface-highest": "var(--docid-surface-highest)",
        border: "var(--docid-border)",
        outline: "var(--docid-outline)",
        text: "var(--docid-text)",
        muted: "var(--docid-muted)",
        primary: "var(--docid-primary)",
        "primary-soft": "var(--docid-primary-soft)",
        secondary: "var(--docid-secondary)",
        "secondary-container": "var(--docid-secondary-container)",
        tertiary: "var(--docid-tertiary)",
        error: "var(--docid-error)",
      };
      for (const shade of shades) {
        newUtilities[`.bg-docid-${shade}`] = { "background-color": cssVars[shade] };
        newUtilities[`.text-docid-${shade}`] = { color: cssVars[shade] };
        newUtilities[`.border-docid-${shade}`] = { "border-color": cssVars[shade] };
        newUtilities[`.divide-docid-${shade} > * + *`] = { "border-color": cssVars[shade] };
        newUtilities[`.ring-docid-${shade}`] = { "--tw-ring-color": cssVars[shade] };
        newUtilities[`.fill-docid-${shade}`] = { fill: cssVars[shade] };
      }
      addUtilities(newUtilities, ["responsive", "dark"]);
    },
  ],
} satisfies Config;
