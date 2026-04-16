export const endpoints = {
  auth: {
    login: "/login",
    me: "/me",
    register: "/register",
    forgotPassword: "/forgot-password",
  },
  patient: {
    overview: "/patient/dashboard/overview",
    appointments: "/patient/dashboard/appointments",
    profile: "/patient/dashboard/profile",
    bookingOptions: "/patient/dashboard/booking-options",
    records: "/patient/dashboard/records",
    pharmacy: "/patient/dashboard/pharmacy",
    dispensing: "/patient/dashboard/dispensing",
    assistant: "/patient/dashboard/assistant/respond",
  },
  doctor: {
    dashboard: "/doctor/dashboard",
    profile: "/doctor/dashboard/profile",
    encounters: "/doctor/dashboard/encounters/submit",
    assistant: "/doctor/dashboard/assistant/respond",
  },
  pharmacist: {
    prescriptions: "/pharmacist/dashboard/prescriptions",
    dispense: "/pharmacist/dashboard/dispense",
  },
  pharmacyAdmin: {
    inventoryBase: "/pharmacy-admin/inventory",
  },
  hospitalAdmin: {
    dashboard: "/hospital-admin/dashboard",
    affiliationDecision: "/hospital-admin/affiliations/decision",
    affiliationRevoke: "/hospital-admin/affiliations/revoke",
    availabilityBase: "/hospital-admin/availability",
    invite: "/hospital-admin/invite",
  },
  healthMinistryAdmin: {
    dashboard: "/moh-admin/dashboard",
    approveOrganization: "/moh-admin/organizations/approve",
    approveDoctor: "/moh-admin/doctors/approve",
    suspend: "/moh-admin/suspend",
    analyticsIncidence: "/moh-admin/analytics/incidence",
    analyticsTopDiagnoses: "/moh-admin/analytics/top-diagnoses",
    monthlyReport: "/moh-admin/reports/monthly",
  },
} as const;
