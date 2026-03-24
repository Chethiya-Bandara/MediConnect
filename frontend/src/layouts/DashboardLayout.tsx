import { Link, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../features/auth/context/AuthContext";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <Link to="/dashboard" className="dashboard-brand">
          National Health Ecosystem
        </Link>
        <div className="dashboard-user">
          <div>
            <p>{user?.name ?? "User"}</p>
            <small>{user?.role ?? "N/A"}</small>
          </div>
          <button type="button" onClick={handleLogout} className="ghost-btn">
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>
      <main className="dashboard-main">
        <Outlet />
      </main>
    </div>
  );
}
