/** @type {import('tailwindcss').Config} */
export default {
  content: ["./ui/index.html", "./ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#20242a",
        muted: "#667085",
        line: "#e4e7ec",
        panel: "#ffffff",
        canvas: "#f6f7f9"
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16, 24, 40, 0.06)"
      }
    }
  },
  plugins: []
};
