import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface CustomSelectFieldProps {
  id?: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly CustomSelectOption[];
  placeholder: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
}

export function CustomSelectField({
  id,
  name,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  helperText,
  disabled = false,
  className,
  triggerClassName,
}: CustomSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = options.find((option) => option.value === value);

  return (
    <label className="field-wrapper">
      <span className="field-label">{label}</span>
      <div
        ref={rootRef}
        className={clsx(
          "custom-select",
          open && "custom-select--open",
          error && "custom-select--error",
          disabled && "opacity-60",
          className,
        )}
      >
        <button
          id={id}
          name={name}
          type="button"
          className={clsx("custom-select__trigger", triggerClassName)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen((current) => !current);
            }
          }}
        >
          <span>{selected?.label ?? placeholder}</span>
          <ChevronDown
            size={18}
            className={clsx("custom-select__chevron", open && "custom-select__chevron--open")}
          />
        </button>

        {open && !disabled ? (
          <div className="custom-select__menu max-h-72 overflow-y-auto" role="listbox" aria-labelledby={id}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={clsx(
                  "custom-select__option custom-select__option--compact",
                  value === option.value && "custom-select__option--selected",
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="custom-select__option-label">{option.label}</span>
                {option.description ? (
                  <span className="custom-select__option-copy">{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        helperText ? <span className="field-helper">{helperText}</span> : null
      )}
    </label>
  );
}
