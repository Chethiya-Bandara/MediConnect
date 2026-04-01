import { Calendar, IdCard, ShieldCheck, Activity } from "lucide-react";
import { useAuth } from "../../auth/context/AuthContext";

export function DashboardHomePage() {
  const { user } = useAuth();

  return (
    <div className="animate-in fade-in space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 font-headline">Welcome Back, {user?.name ?? "User"}</h1>
        <p className="text-slate-500 mt-1">Manage your health profile, records, and access role-specific tools.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Generic Dashboard Intro) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 h-full">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4 font-headline">
              <Activity size={18} className="text-blue-500" /> Account Status
            </h3>
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-sm text-slate-500 font-medium mb-1">Active Role</p>
                <div className="flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                    {user?.role}
                  </span>
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-sm text-slate-500 font-medium mb-1">Signed in as</p>
                <p className="text-sm font-bold text-slate-800">{user?.email}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Middle/Right Column (Next Steps) */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 h-full">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 font-headline">
                <ShieldCheck size={18} className="text-green-500" /> Identity and Access
              </h3>
            </div>

            <ul className="space-y-4">
              <li className="flex items-start gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                  <IdCard size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">DHID/NIC Workflow</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">Identity verification framework is active and ready for the next patient data module.</p>
                </div>
              </li>

              <li className="flex items-start gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div className="p-3 bg-green-50 text-green-600 rounded-xl">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">Authentication Flow</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">Login, registration, validation, and role-based access tokens are fully operational.</p>
                </div>
              </li>

              <li className="flex items-start gap-4 p-4 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                  <Calendar size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">Navigation Shell</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">The unified digital routing shell is prepared for scheduling, ePrescription, and analytics views.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
