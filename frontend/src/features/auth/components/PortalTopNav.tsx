import { useEffect, useState } from "react";
import { HeartPulse, MoonStar, SunMedium } from "lucide-react";
import mediConnectLogo from "../../../../logo/logo.png";

interface PortalTopNavProps {
  brandVariant?: "default" | "mediconnect";
}

export function PortalTopNav({ brandVariant = "default" }: PortalTopNavProps) {
  // 1. Change initial state to "light"
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("patient-dashboard-theme");
    // 2. Only set to "dark" if specifically found in localStorage
    // otherwise, stay as "light"
    if (savedTheme === "dark") {
      setTheme("dark");
    } else {
      setTheme("light");
    }
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
        <div className={`brand-wrap ${brandVariant === "mediconnect" ? "brand-wrap--mediconnect" : ""}`}>
          {brandVariant === "mediconnect" ? (
            <>
              <img src={mediConnectLogo} alt="MediConnect logo" className="brand-wrap__logo" />
              <div className="brand-wrap__copy">
                <span className="brand-wrap__title">
                  <span className="brand-wrap__title-medi">Medi</span>
                  <span className="brand-wrap__title-connect">Connect</span>
                </span>
                <span className="brand-wrap__subtitle">Healthcare Integration Network</span>
              </div>
            </>
          ) : (
            <>
              <HeartPulse size={20} />
              <span>National Health Ecosystem</span>
            </>
          )}
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
          {/* 3. The icon logic should match: show Sun when in dark mode to switch to light */}
          {theme === "dark" ? <SunMedium size={18} /> : <MoonStar size={18} />}
        </button>
      </div>
    </nav>
  );
}