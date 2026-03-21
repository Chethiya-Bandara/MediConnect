import { Calendar, IdCard, ShieldCheck } from "lucide-react";
import { Card } from "../../../components/ui";
import { useAuth } from "../../auth/context/AuthContext";

export function DashboardHomePage() {
  const { user } = useAuth();

  return (
    <div className="dashboard-grid">
      <Card title="Role-based dashboard layout">
        <p>
          Signed in as <strong>{user?.name}</strong>
        </p>
        <p>
          Active role: <span className="role-pill">{user?.role}</span>
        </p>
      </Card>

      <Card title="Identity and access">
        <ul className="ui-check-list">
          <li>
            <IdCard size={14} /> DHID/NIC workflow ready for next module.
          </li>
          <li>
            <ShieldCheck size={14} /> Login, registration, and validation are live.
          </li>
          <li>
            <Calendar size={14} /> Navigation shell ready for appointment views.
          </li>
        </ul>
      </Card>
    </div>
  );
}
