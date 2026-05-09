export function calculateAge(dob: string): number | null {
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age;
}

export type NicDerivedGender = "MALE" | "FEMALE";

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function buildIsoDate(year: number, dayOfYear: number) {
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  const matchesYear = date.getUTCFullYear() === year;
  const expectedDayCount = isLeapYear(year) ? 366 : 365;

  if (!matchesYear || dayOfYear < 1 || dayOfYear > expectedDayCount) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function parseSriLankanNic(nic: string): {
  birthDate: string;
  gender: NicDerivedGender;
} | null {
  const normalized = nic.trim().toUpperCase();
  const isOldNic = /^\d{9}[VX]$/.test(normalized);
  const isNewNic = /^\d{12}$/.test(normalized);

  if (!isOldNic && !isNewNic) {
    return null;
  }

  const year = isOldNic
    ? 1900 + Number.parseInt(normalized.slice(0, 2), 10)
    : Number.parseInt(normalized.slice(0, 4), 10);
  const rawDayValue = Number.parseInt(
    isOldNic ? normalized.slice(2, 5) : normalized.slice(4, 7),
    10,
  );
  const gender = rawDayValue > 500 ? "FEMALE" : "MALE";
  const dayOfYear = rawDayValue > 500 ? rawDayValue - 500 : rawDayValue;
  const birthDate = buildIsoDate(year, dayOfYear);

  if (!birthDate) {
    return null;
  }

  return { birthDate, gender };
}
