import { useEffect, useState } from "react";
import { HeartPulse, MoonStar, SunMedium } from "lucide-react";

export function PortalTopNav() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const savedTheme = localStorage.getItem("patient-dashboard-theme");
    setTheme(savedTheme === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("patient-dashboard-theme", theme);
  }, [theme]);

  return (
    <nav className="portal-nav">
      <div className="portal-nav-inner">
        <div className="brand-wrap">
          <HeartPulse size={20} />
          <span>National Health Ecosystem</span>
        </div>
        <button
          type="button"
          onClick={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          className="auth-theme-toggle"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
        </button>
      </div>
    </nav>
  );
}
