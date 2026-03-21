import type { InputHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  leadingIcon?: ReactNode;
  inputClassName?: string;
}

export function InputField({
  id,
  label,
  error,
  helperText,
  leadingIcon,
  className,
  inputClassName,
  ...props
}: InputFieldProps) {
  return (
    <label className="field-wrapper" htmlFor={id}>
      <span className="field-label">{label}</span>
      <div className="field-control">
        {leadingIcon && <span className="field-icon">{leadingIcon}</span>}
        <input
          id={id}
          className={clsx(
            "field-input",
            leadingIcon && "field-input--with-icon",
            error && "field-input--error",
            inputClassName,
            className,
          )}
          {...props}
        />
      </div>
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        helperText && <span className="field-helper">{helperText}</span>
      )}
    </label>
  );
}
