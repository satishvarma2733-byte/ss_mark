import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

// Figma "SS / Button" (94:271). One look for the whole app: these render the `.button` rules in app/globals.css
// (48px, olive fill, hover/pressed states from the polish layer), so pages and kit share a single style.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type Look = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; /** @deprecated use `block` */ fullWidth?: boolean; className?: string };

function buttonClass({ variant = "primary", size = "md", block, fullWidth, className = "" }: Look) {
  return ["button", variant === "primary" ? "" : variant, size === "md" ? "" : size, block || fullWidth ? "block" : "", className].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Look {
  loading?: boolean;
  leftIcon?: ReactNode;
}

export function Button({ variant, size, block, fullWidth, loading = false, leftIcon, className, disabled, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, size, block, fullWidth, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="ss-spinner" aria-hidden="true" /> : leftIcon}
      {children}
    </button>
  );
}

// A link that looks like a button (plain anchor: navigation reloads server data, as the pages already do).
export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, Look {
  href: string;
}

export function ButtonLink({ variant, size, block, fullWidth, className, children, ...rest }: ButtonLinkProps) {
  return (
    <a className={buttonClass({ variant, size, block, fullWidth, className })} {...rest}>
      {children}
    </a>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: "ghost" | "secondary" | "primary";
}

export function IconButton({ label, variant = "ghost", className = "", type = "button", children, ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`ss-icon-btn ss-icon-btn--${variant} ${className}`.trim()} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
