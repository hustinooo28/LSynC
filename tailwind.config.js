/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware surfaces & text (values live in src/index.css)
        page: token("page"),
        surface: { DEFAULT: token("surface"), 2: token("surface-2") },
        line: token("line"),
        ink: token("ink"),
        muted: token("muted"),
        // "Sexy Blue" brand scale anchored at #007BFF
        brand: {
          50: "#EBF5FF",
          100: "#D6EBFF",
          200: "#ADD6FF",
          300: "#70B8FF",
          400: "#3399FF",
          500: "#007BFF",
          600: "#0066E0",
          700: "#0050B8",
          800: "#0A3A8C",
          900: "#0B2463",
          950: "#050A3A",
        },
        indigo: { 500: "#4B5BFF", 700: "#1B22B8", 900: "#070B5C" },
        powder: "#B0E0E6",
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        soft: "0 1px 2px rgb(10 16 51 / 0.04), 0 8px 24px -12px rgb(10 16 51 / 0.12)",
        lift: "0 2px 4px rgb(10 16 51 / 0.05), 0 24px 48px -20px rgb(0 80 184 / 0.35)",
        glow: "0 10px 30px -8px rgb(0 123 255 / 0.65)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", translate: "0 12px" },
          to: { opacity: "1", translate: "none" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(.2,.7,.2,1) both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
