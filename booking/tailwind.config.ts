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
          DEFAULT: "#1a7f8e",
          light: "#22a4b5",
          dark: "#0d5f6b",
        },
        ink: {
          DEFAULT: "#0b0f10",
          soft: "#11181b",
          muted: "#8a979c",
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
