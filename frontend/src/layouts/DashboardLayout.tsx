import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Activity, Moon, Sun } from "lucide-react";
import { useAuth } from "../features/auth/context/AuthContext";
import { Button } from "../components/ui/Button";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isDarkMode, setIsDarkMode] = useState(true);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const userInitials = (user?.name ?? "U")
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className={`dashboard-shell ${isDarkMode ? "theme-dark" : "theme-light"}`}>
      <header className="dashboard-topbar">
        <div className="dashboard-brand-wrap">
          <div className="dashboard-brand-icon">
            <Activity size={18} />
          </div>
          <strong className="dashboard-brand-text">MediConnect</strong>
        </div>

        <nav className="dashboard-nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>

        <div className="dashboard-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsDarkMode((current) => !current)}
            aria-label="Toggle dashboard theme"
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="dashboard-user-meta">
            <div className="dashboard-user-copy">
              <p>{user?.name ?? "Unknown User"}</p>
              <small>{user?.role ?? "N/A"}</small>
            </div>
            <span className="user-avatar">{userInitials}</span>
          </div>

          <Button variant="ghost" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="dashboard-main">
        <Outlet />
      </main>
    </div>
  );
}
