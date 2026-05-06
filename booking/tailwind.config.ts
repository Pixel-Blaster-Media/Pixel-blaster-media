import type { Config } from "tailwindcss";

// Brand palette mirrors ../style.css custom properties so the booking app
// feels like a natural extension of pixelblastermedia.com.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)",
          light: "rgb(var(--brand-light-rgb) / <alpha-value>)",
          dark: "rgb(var(--brand-dark-rgb) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink-rgb) / <alpha-value>)",
          soft: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
          muted: "rgb(var(--ink-muted-rgb) / <alpha-value>)",
        },
        realtor: {
          bg: "rgb(var(--realtor-bg-rgb) / <alpha-value>)",
          soft: "rgb(var(--realtor-bg-soft-rgb) / <alpha-value>)",
          surface: "rgb(var(--realtor-surface-rgb) / <alpha-value>)",
          muted: "rgb(var(--realtor-muted-rgb) / <alpha-value>)",
          text: "rgb(var(--realtor-text-rgb) / <alpha-value>)",
          primary: "rgb(var(--realtor-primary-rgb) / <alpha-value>)",
          accent: "rgb(var(--realtor-accent-rgb) / <alpha-value>)",
          blush: "rgb(var(--realtor-blush-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34, 164, 181, 0.3), 0 10px 40px -10px rgba(34, 164, 181, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
