import { useState } from "react";
import { CalendarDays, MailPlus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import type {
  CreateAvailabilityPayload,
  HospitalAvailabilitySlot,
  InviteDoctorPayload,
} from "../types";

interface DoctorsSectionProps {
  availabilityDoctorIdInput: string;
  activeDoctorId: string | null;
  availabilitySlots: HospitalAvailabilitySlot[];
  message: string | null;
  error: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onAvailabilityDoctorIdChange: (value: string) => void;
  onLoadAvailability: () => Promise<boolean>;
  onCreateAvailability: (payload: CreateAvailabilityPayload) => Promise<boolean>;
  onInviteDoctor: (payload: InviteDoctorPayload) => Promise<boolean>;
}

export function DoctorsSection({
  availabilityDoctorIdInput,
  activeDoctorId,
  availabilitySlots,
  message,
  error,
  isLoading,
  isSubmitting,
  onAvailabilityDoctorIdChange,
  onLoadAvailability,
  onCreateAvailability,
  onInviteDoctor,
}: DoctorsSectionProps) {
  const getSriLankaTodayInputValue = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [inviteDoctorEmail, setInviteDoctorEmail] = useState("");
  const [availabilityDoctorId, setAvailabilityDoctorId] = useState("");
  const [availabilityHospitalId, setAvailabilityHospitalId] = useState("");
  const [availabilityDate, setAvailabilityDate] = useState(getSriLankaTodayInputValue);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");

  const handleInviteDoctor = async () => {
    const payload = {
      doctorEmail: inviteDoctorEmail.trim(),
    };

    if (!payload.doctorEmail) {
      return;
    }

    const success = await onInviteDoctor(payload);
    if (success) {
      setInviteDoctorEmail("");
    }
  };

  const handleCreateAvailability = async () => {
    const payload = {
      doctorId: availabilityDoctorId.trim(),
      slotDate: availabilityDate,
      startTime,
      endTime,
      slotDurationMinutes: 15,
    };

    if (!payload.doctorId || !availabilityHospitalId.trim()) {
      return;
    }

    const success = await onCreateAvailability(payload);
    if (success) {
      onAvailabilityDoctorIdChange(payload.doctorId);
    }
  };

  return (
    <section className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <MailPlus className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Invite Doctor
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Send a hospital invitation using the doctor's login email.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Doctor Email
              </span>
              <input
                type="email"
                value={inviteDoctorEmail}
                onChange={(event) => setInviteDoctorEmail(event.target.value)}
                placeholder="doctor@example.com"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <Button
              type="button"
              isLoading={isSubmitting}
              disabled={!inviteDoctorEmail.trim()}
              onClick={() => void handleInviteDoctor()}
              className="bg-primary py-3 text-white dark:bg-blue-600"
            >
              Send Invitation
            </Button>
          </div>
        </article>

        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Create Availability Slot
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Build doctor availability directly from the hospital admin console.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Doctor ID
              </span>
              <input
                value={availabilityDoctorId}
                onChange={(event) => setAvailabilityDoctorId(event.target.value)}
                placeholder="Enter doctor ID"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Hospital ID
              </span>
              <input
                value={availabilityHospitalId}
                onChange={(event) => setAvailabilityHospitalId(event.target.value)}
                placeholder="Enter hospital ID"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Date
              </span>
              <input
                type="date"
                value={availabilityDate}
                onChange={(event) => setAvailabilityDate(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <div className="grid gap-4 grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                  Start
                </span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                  End
                </span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
          </div>

          <Button
            type="button"
            isLoading={isSubmitting}
            disabled={!availabilityDoctorId.trim() || !availabilityHospitalId.trim()}
            onClick={() => void handleCreateAvailability()}
            className="mt-5 w-full bg-emerald-600 py-3 text-white hover:bg-emerald-700"
          >
            Create Availability
          </Button>
        </article>
      </div>

      <div className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              View Doctor Availability
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Load the slot list for a doctor and review the current hospital schedule windows.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr,auto] lg:min-w-[28rem]">
            <input
              value={availabilityDoctorIdInput}
              onChange={(event) => onAvailabilityDoctorIdChange(event.target.value)}
              placeholder="Enter doctor ID"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <Button
              type="button"
              isLoading={isLoading}
              onClick={() => void onLoadAvailability()}
              className="bg-slate-900 px-5 py-3 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Load Schedule
            </Button>
          </div>
        </div>

        {message ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {message}
          </div>
        ) : null}
      </div>

      {isLoading ? <LoadingState message="Loading doctor availability..." /> : null}
      {error ? <ErrorState title="Doctor operations unavailable" message={error} /> : null}

      {!isLoading && !error ? (
        availabilitySlots.length === 0 ? (
          <EmptyState
            title="No availability loaded"
            description={`${
              activeDoctorId ? `Doctor ${activeDoctorId}` : "No doctor"
            } does not currently have loaded availability slots, or the backend returned an empty list.`}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {availabilitySlots.map((slot) => (
              <article
                key={slot.id}
                className="rounded-[1.7rem] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                  {slot.dayOfWeek ?? "Unknown day"}
                </p>
                <p className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-100">
                  {slot.startTime ?? "?"} to {slot.endTime ?? "?"}
                </p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Doctor {slot.doctorId ?? "Unknown"} • Hospital {slot.hospitalId ?? "Unknown"}
                </p>
              </article>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
