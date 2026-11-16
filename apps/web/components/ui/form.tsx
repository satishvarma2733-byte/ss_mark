"use client";

import { Search, X } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="ss-field">
      <label className="ss-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ss-field__req" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="ss-field__hint">{hint}</p> : null}
      {error ? (
        <p className="ss-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ className = "", error, ...rest }: InputProps) {
  return <input className={`ss-input ${error ? "ss-input--error" : ""} ${className}`.trim()} aria-invalid={error || undefined} {...rest} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ className = "", error, ...rest }: TextareaProps) {
  return <textarea className={`ss-input ss-textarea ${error ? "ss-input--error" : ""} ${className}`.trim()} aria-invalid={error || undefined} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ className = "", error, children, ...rest }: SelectProps) {
  return (
    <select className={`ss-input ss-select ${error ? "ss-input--error" : ""} ${className}`.trim()} aria-invalid={error || undefined} {...rest}>
      {children}
    </select>
  );
}

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  onSubmit?: () => void;
}

export function SearchBar({ value, onChange, placeholder = "Search spaces, areas, or bookings...", label = "Search", onSubmit }: SearchBarProps) {
  const id = useId();
  return (
    <div className="ss-search">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Search className="ss-search__icon" size={18} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className="ss-search__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
      />
      {value ? (
        <button type="button" className="ss-search__clear" onClick={() => onChange("")} aria-label="Clear search">
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function Checkbox({ label, id, className = "", ...rest }: CheckboxProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  return (
    <label className={`ss-check ${className}`.trim()} htmlFor={inputId}>
      <input id={inputId} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name: string;
  legend: string;
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
}

export function RadioGroup({ name, legend, value, options, onChange }: RadioGroupProps) {
  return (
    <fieldset className="ss-radio-group">
      <legend className="ss-field__label">{legend}</legend>
      <div className="ss-radio-group__list">
        {options.map((opt) => (
          <label key={opt.value} className={`ss-radio ${value === opt.value ? "ss-radio--selected" : ""}`}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
            />
            <span>
              <strong>{opt.label}</strong>
              {opt.description ? <small>{opt.description}</small> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Keep the label for screen readers only (when a visible heading already names the choice). */
  hideLabel?: boolean;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, hideLabel, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="ss-switch-row">
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : "ss-switch-row__label"}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`ss-switch ${checked ? "ss-switch--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ss-switch__thumb" />
      </button>
    </div>
  );
}
