import { Outlet, useNavigate } from "react-router-dom";
import { LogOut, Activity } from "lucide-react";
import { useAuth } from "../features/auth/context/AuthContext";

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen font-body transition-colors duration-300 bg-slate-50 text-slate-800">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Activity className="text-white" size={20} />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 font-headline">
            MediConnect
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-slate-800 font-headline">{user?.name ?? "User"}</p>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{user?.role ?? "N/A"}</p>
          </div>
          
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold border border-blue-200">
            {user?.name ? user.name.substring(0, 2).toUpperCase() : "US"}
          </div>

          <button 
            type="button" 
            onClick={handleLogout} 
            className="p-2 ml-2 text-slate-400 hover:bg-slate-100 hover:text-error rounded-full transition-colors flex items-center gap-2"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
