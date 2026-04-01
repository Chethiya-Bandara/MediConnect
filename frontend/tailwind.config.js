import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "error": "#ba1a1a",
        "surface-bright": "#f7fafc",
        "secondary-fixed-dim": "#81cfff",
        "primary": "#004275",
        "inverse-on-surface": "#eef1f3",
        "on-surface-variant": "#414750",
        "background": "#f7fafc",
        "surface-tint": "#1261a3",
        "on-tertiary-container": "#ffc29c",
        "primary-container": "#005a9c",
        "on-primary-container": "#afd1ff",
        "surface-variant": "#e0e3e5",
        "on-primary-fixed": "#001c37",
        "tertiary-fixed": "#ffdcc7",
        "on-secondary-fixed-variant": "#004c6b",
        "on-error": "#ffffff",
        "on-secondary-container": "#004b69",
        "on-primary": "#ffffff",
        "on-error-container": "#93000a",
        "secondary-fixed": "#c6e7ff",
        "surface-container": "#ebeef0",
        "secondary": "#00658d",
        "outline": "#727781",
        "surface-container-high": "#e5e9eb",
        "surface": "#f7fafc",
        "primary-fixed-dim": "#a1c9ff",
        "on-tertiary-fixed-variant": "#733600",
        "tertiary": "#6a3100",
        "on-tertiary-fixed": "#311300",
        "error-container": "#ffdad6",
        "surface-container-lowest": "#ffffff",
        "tertiary-container": "#8d4401",
        "secondary-container": "#41befd",
        "primary-fixed": "#d2e4ff",
        "on-primary-fixed-variant": "#00487f",
        "inverse-primary": "#a1c9ff",
        "outline-variant": "#c1c7d2",
        "inverse-surface": "#2d3133",
        "on-tertiary": "#ffffff",
        "surface-container-low": "#f1f4f6",
        "surface-container-highest": "#e0e3e5",
        "tertiary-fixed-dim": "#ffb787",
        "on-surface": "#181c1e",
        "on-background": "#181c1e",
        "on-secondary": "#ffffff",
        "surface-dim": "#d7dadc",
        "on-secondary-fixed": "#001e2d"
      },
      fontFamily: {
        "headline": ["Manrope"],
        "body": ["Inter"],
        "label": ["Inter"]
      },
      borderRadius: {
        "DEFAULT": "0.375rem", 
        "lg": "0.5rem", 
        "xl": "0.75rem", 
        "full": "1.5rem"
      },
    },
  },
  plugins: [forms, containerQueries],
}
