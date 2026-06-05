import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101318",
        paper: "#f7f8fb",
        ember: "#ff5a36",
        lagoon: "#2fa7a3",
        brass: "#d69b2d",
        violetmark: "#7057ff"
      },
      boxShadow: {
        panel: "0 18px 50px rgba(12, 18, 30, 0.12)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;

