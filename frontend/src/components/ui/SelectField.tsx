import type { SelectHTMLAttributes } from "react";
import clsx from "clsx";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: SelectOption[];
}

export function SelectField({ id, label, error, options, className, ...props }: SelectFieldProps) {
  return (
    <label className="field-wrapper" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select
        id={id}
        className={clsx("field-input", error && "field-input--error", className)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
