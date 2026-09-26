import type { Config } from "tailwindcss"

const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`

/**
 * Tokens below are recovered verbatim from the legacy build
 * (legacy/assets/index-0GK1rzsZ.css) so the rebuild matches the original
 * design. Do not renumber them casually — see docs/RECOVERY.md.
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: hsl("--border"),
        input: hsl("--input"),
        ring: hsl("--ring"),
        background: hsl("--background"),
        foreground: hsl("--foreground"),
        primary: {
          DEFAULT: hsl("--primary"),
          foreground: hsl("--primary-foreground"),
        },
        secondary: {
          DEFAULT: hsl("--secondary"),
          foreground: hsl("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: hsl("--destructive"),
          foreground: hsl("--destructive-foreground"),
        },
        muted: {
          DEFAULT: hsl("--muted"),
          foreground: hsl("--muted-foreground"),
        },
        accent: {
          DEFAULT: hsl("--accent"),
          foreground: hsl("--accent-foreground"),
        },
        popover: {
          DEFAULT: hsl("--popover"),
          foreground: hsl("--popover-foreground"),
          border: hsl("--popover-border"),
        },
        card: {
          DEFAULT: hsl("--card"),
          foreground: hsl("--card-foreground"),
          border: hsl("--card-border"),
        },
        sidebar: {
          DEFAULT: hsl("--sidebar"),
          foreground: hsl("--sidebar-foreground"),
          border: hsl("--sidebar-border"),
          primary: hsl("--sidebar-primary"),
          "primary-foreground": hsl("--sidebar-primary-foreground"),
          accent: hsl("--sidebar-accent"),
          "accent-foreground": hsl("--sidebar-accent-foreground"),
          ring: hsl("--sidebar-ring"),
        },
        chart: {
          1: hsl("--chart-1"),
          2: hsl("--chart-2"),
          3: hsl("--chart-3"),
          4: hsl("--chart-4"),
          5: hsl("--chart-5"),
        },
        elevate: {
          1: "var(--elevate-1)",
          2: "var(--elevate-2)",
        },
        "button-outline": "var(--button-outline)",
        "badge-outline": "var(--badge-outline)",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        "2xs": "var(--shadow-2xs)",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config
