import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-surface-muted text-fg hover:bg-surface-hover",
  outline: "border border-border bg-surface text-fg hover:bg-surface-hover",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-danger text-danger-fg hover:brightness-110",
};

/* Cao toi thieu 44px tren mobile: dat muc tieu cham cua iOS/Android.
   Tu sm tro len thu nho lai cho gon desktop. */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-10 px-3 text-sm gap-1.5 sm:h-8",
  md: "h-11 px-4 text-base gap-2 sm:h-10 sm:text-sm",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-11 w-11 sm:h-10 sm:w-10",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Chiem tron chieu ngang - hay dung cho nut chinh tren mobile. */
  block?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // Dang xu ly: chan bam bang aria-disabled + preventDefault, KHONG dat
      // `disabled`. Nut disabled bi tuoc focus, nguoi dung ban phim roi ve <body>.
      // aria-busy de screen reader biet dang cho.
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={disabled}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-ui font-medium transition-colors",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // Dang xu ly thi khong mo nhu nut khoa: chi spinner noi dang chay.
        "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
