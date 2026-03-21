import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Activity, CheckCircle2, Moon, Sun } from "lucide-react";

const highlights = [
  "National Digital Health ID (DHID) support",
  "Role-based access with strict privacy rules",
  "Workflow-ready UI for hospitals and pharmacies",
];

export function AuthLayout() {
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <div className={`auth-shell ${isDarkMode ? "theme-dark" : "theme-light"}`}>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setIsDarkMode((current) => !current)}
        aria-label="Toggle theme"
      >
        {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <aside className="auth-hero">
        <div className="hero-blob hero-blob-one" />
        <div className="hero-blob hero-blob-two" />
        <div className="hero-blob hero-blob-three" />

        <div className="auth-hero-content">
          <div className="hero-brand">
            <span className="hero-brand-icon">
              <Activity size={26} />
            </span>
            <span>MediConnect</span>
          </div>

          <h1>Sri Lanka's unified digital healthcare platform</h1>
          <p>
            Securely connecting patients, doctors, hospitals, and pharmacies with
            one role-aware experience.
          </p>

          <ul className="hero-points">
            {highlights.map((item) => (
              <li key={item}>
                <CheckCircle2 size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="auth-link-row">
            <NavLink to="/login">Login</NavLink>
            <NavLink to="/register">Register</NavLink>
          </div>
        </div>
      </aside>

      <main className="auth-stage">
        <div className="auth-mobile-brand">
          <span className="hero-brand-icon">
            <Activity size={22} />
          </span>
          <span>MediConnect</span>
        </div>

        <div className="auth-form-card">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
