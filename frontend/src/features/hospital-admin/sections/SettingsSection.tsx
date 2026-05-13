import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  MoonStar,
  ShieldCheck,
  SunMedium,
  Upload,
  UserRound,
} from "lucide-react";
import type { AuthUser } from "../../../types/auth";

type ThemeMode = "light" | "dark";

interface SettingsSectionProps {
  user: AuthUser | null;
  hospitalId: string | null;
  hospitalName: string | null;
  hospitalType: string | null;
  hospitalStatus: string | null;
  activeDoctorId: string | null;
  theme: ThemeMode;
  saveMessage: string | null;
  isSaving: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onSave: (payload: { preferredName: string; address: string }) => Promise<void>;
  onLogout: () => void;
}

function buildInitials(name: string | null | undefined) {
  const safe = (name || "Hospital Admin").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "HA"
  );
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function noticeClassName(message: string | null | undefined) {
  if (!message) {
    return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
  const lowered = message.toLowerCase();
  if (
    lowered.includes("fail") ||
    lowered.includes("error") ||
    lowered.includes("invalid") ||
    lowered.includes("not found")
  ) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300";
}

export function SettingsSection({
  user,
  hospitalId,
  hospitalName,
  hospitalType,
  hospitalStatus,
  activeDoctorId,
  theme,
  saveMessage,
  isSaving,
  onThemeChange,
  onSave,
  onLogout,
}: SettingsSectionProps) {
  const [preferredName, setPreferredName] = useState(user?.preferredName ?? user?.name ?? "");
  const [address, setAddress] = useState(user?.address ?? "");
  const [photo, setPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const legalName = user?.legalName ?? user?.name ?? "Not available";
  const previewName = preferredName.trim() || user?.preferredName || user?.name || "Hospital Admin";
  const previewInitials = buildInitials(previewName);
  const organisationId = hospitalId ?? (user?.organisationId != null ? String(user.organisationId) : null);
  const storageKey = useMemo(
    () => `hospital-admin-profile-photo:${user?.id ?? user?.email ?? "guest"}`,
    [user?.email, user?.id],
  );

  useEffect(() => {
    setPreferredName(user?.preferredName ?? user?.name ?? "");
    setAddress(user?.address ?? "");
  }, [user?.address, user?.name, user?.preferredName]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    setPhoto(stored);
  }, [storageKey]);

  const isDirty =
    preferredName.trim() !== (user?.preferredName ?? user?.name ?? "").trim() ||
    address.trim() !== (user?.address ?? "").trim();
  const isValid = preferredName.trim().length >= 2 && address.trim().length >= 5;

  const handlePhotoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setPhoto(result);
      if (typeof window !== "undefined") {
        if (result) {
          window.localStorage.setItem(storageKey, result);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setPreferredName(user?.preferredName ?? user?.name ?? "");
    setAddress(user?.address ?? "");
  };

  const removePhoto = () => {
    setPhoto(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  };

  return (
    <section className="animate-fadeIn">
      <div className="mb-8 rounded-[2rem] border border-slate-200 bg-white px-8 py-7 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 text-2xl font-black text-cyan-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300">
              {photo ? (
                <img src={photo} alt={`${previewName} avatar`} className="h-full w-full object-cover" />
              ) : (
                previewInitials
              )}
            </div>
            <div>
              <p className="rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                Hospital Admin Profile
              </p>
              <h2 className="mt-3 text-3xl font-black text-slate-900 dark:text-white">
                {previewName}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {hospitalName ?? "Hospital scope not linked yet"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-bold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-700 dark:text-cyan-400">
                Profile
              </p>
              <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white">
                Identity settings
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Update the hospital-facing profile details shown across this workspace.
              </p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 text-cyan-700 shadow-sm dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              <UserRound size={22} />
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 text-lg font-black tracking-[0.08em] text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                  {photo ? (
                    <img src={photo} alt={`${previewName} avatar`} className="h-full w-full object-cover" />
                  ) : (
                    previewInitials
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    Profile photo
                  </p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    Upload a photo or keep the initials badge.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Upload size={16} />
                  Upload photo
                </button>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                Preferred Name
              </span>
              <input
                type="text"
                value={preferredName}
                onChange={(event) => setPreferredName(event.target.value)}
                className="w-full rounded-xl border-0 bg-slate-100 px-4 py-3 shadow-inner focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                placeholder="Chief Admin Silva"
              />
            </label>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                Legal name on NIC
              </p>
              <p className="mt-2 font-semibold">{legalName}</p>
            </div>

            <label className="block md:col-span-2">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">
                Address
              </span>
              <textarea
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border-0 bg-slate-100 px-4 py-3 shadow-inner focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:text-white"
                placeholder="221B Galle Road, Colombo"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[1fr_auto]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                Profile status
              </p>
              <p className="mt-2 font-semibold">
                {isDirty ? "Unsaved changes" : "Everything saved"}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Workspace theme
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onThemeChange("light")}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    theme === "light"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                      : "border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  <SunMedium size={16} />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => onThemeChange("dark")}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    theme === "dark"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                      : "border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                >
                  <MoonStar size={16} />
                  Dark
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void onSave({ preferredName, address })}
              disabled={isSaving || !isDirty || !isValid}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isSaving || !isDirty}
              className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              Reset Changes
            </button>
          </div>

          {saveMessage ? (
            <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${noticeClassName(saveMessage)}`}>
              {saveMessage}
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-500/70 dark:text-cyan-400/50">
                  Read Only
                </p>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white">
                  Hospital details
                </h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Operational scope already linked to this admin account.
                </p>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 text-cyan-700 shadow-sm dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                <ShieldCheck size={22} />
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Primary Email
                </p>
                <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                  {user?.email ?? "No email saved"}
                </p>
              </div>
              <div className="border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Hospital Name
                </p>
                <p className="mt-2 text-xl font-black text-cyan-900 dark:text-cyan-300">
                  {hospitalName ?? "Not linked"}
                </p>
              </div>
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Organisation Type
                </p>
                <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                  {formatStatusLabel(hospitalType ?? user?.organisationType)}
                </p>
              </div>
              <div className="border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Organisation ID
                </p>
                <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">
                  {organisationId ?? "Not linked"}
                </p>
              </div>
              <div className="border-b border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Account Status
                </p>
                <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">
                  {formatStatusLabel(user?.status ?? hospitalStatus ?? user?.organisationStatus)}
                </p>
              </div>
              <div className="bg-slate-50 px-5 py-4 dark:bg-slate-800/40">
                <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-slate-400">
                  Active Doctor Context
                </p>
                <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">
                  {activeDoctorId ?? "No doctor selected"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
