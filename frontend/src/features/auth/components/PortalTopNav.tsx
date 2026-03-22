import { HeartPulse } from "lucide-react";

export function PortalTopNav() {
  return (
    <nav className="portal-nav">
      <div className="portal-nav-inner">
        <div className="brand-wrap">
          <HeartPulse size={20} />
          <span>National Health Ecosystem</span>
        </div>
      </div>
    </nav>
  );
}
