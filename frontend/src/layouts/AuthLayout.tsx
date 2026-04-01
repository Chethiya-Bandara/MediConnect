import { Outlet } from "react-router-dom";

export function AuthLayout() {
  return (
    <div className="bg-surface font-body text-on-surface min-h-screen flex flex-col">
      <nav className="fixed top-0 w-full z-50 bg-slate-50/80 backdrop-blur-xl shadow-sm h-16 flex items-center justify-between px-6 max-w-screen-2xl mx-auto left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary-container" style={{ fontVariationSettings: "'FILL' 1" }}>health_metrics</span>
          <span className="text-lg font-bold tracking-tighter text-blue-900 font-headline">National Health Ecosystem</span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6 items-center">
            <a className="font-manrope text-sm font-semibold tracking-tight text-slate-600 hover:text-blue-600 transition-colors duration-200" href="#">Help</a>
            <a className="font-manrope text-sm font-semibold tracking-tight text-slate-600 hover:text-blue-600 transition-colors duration-200" href="#">Language</a>
          </div>
          <div className="flex items-center gap-2 text-error font-semibold text-sm px-4 py-2 bg-error-container/30 rounded-full cursor-pointer hover:bg-error-container transition-all">
            <span className="material-symbols-outlined text-[18px]">emergency</span>
            <span>Emergency Services</span>
          </div>
        </div>
      </nav>

      <main className="flex-grow flex items-center justify-center px-4 pt-20 pb-12 w-full">
        <Outlet />
      </main>

      <footer className="w-full bg-slate-50 border-t border-slate-200/30">
        <div className="py-12 px-6 flex flex-col md:flex-row justify-between items-center gap-8 w-full max-w-screen-2xl mx-auto">
          <div className="flex flex-col items-center md:items-start gap-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">health_and_safety</span>
              <span className="text-sm font-bold text-slate-700 font-headline uppercase tracking-widest">National Health Digital Ecosystem</span>
            </div>
            <p className="font-inter text-xs text-slate-500 max-w-xs text-center md:text-left">
              © 2024 National Health Digital Ecosystem. All rights reserved. Providing secure health information exchange for all citizens.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            <a className="font-inter text-xs text-slate-500 hover:text-blue-500 transition-all duration-300" href="#">Privacy Policy</a>
            <a className="font-inter text-xs text-slate-500 hover:text-blue-500 transition-all duration-300" href="#">Terms of Service</a>
            <a className="font-inter text-xs text-slate-500 hover:text-blue-500 transition-all duration-300" href="#">Security Compliance</a>
            <a className="font-inter text-xs text-slate-500 hover:text-blue-500 transition-all duration-300" href="#">Accessibility</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
