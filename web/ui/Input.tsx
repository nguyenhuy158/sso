import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

/* 16px la nguong iOS Safari khong tu zoom khi focus. Chi ha xuong 14px tu sm
   tro len va khi co chuot that (iPad rong hon 640px van bi zoom). */
const CONTROL = cn(
  "w-full rounded-ui border border-border bg-surface text-fg",
  "text-base sm:pointer-fine:text-sm",
  "placeholder:text-fg-muted",
  "outline-none transition focus:border-primary focus:ring-2 focus:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/30",
);

const HEIGHT = "h-11 px-3 sm:h-10";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  // Ten `leading`/`trailing` chu khong phai `prefix`/`suffix`: hai cai sau la
  // thuoc tinh HTML that va da co kieu string, dat de len se sai kieu.
  /** Icon hoac chu dat trong o, ben trai (vi du: bieu tuong tim kiem). */
  leading?: ReactNode;
  /** Icon hoac chu dat trong o, ben phai (vi du: don vi "d"). */
  trailing?: ReactNode;
  invalid?: boolean;
};

export function Input({
  leading,
  trailing,
  invalid,
  className,
  ...rest
}: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        HEIGHT,
        leading && "pl-10",
        trailing && "pr-10",
        className,
      )}
      {...rest}
    />
  );

  if (!leading && !trailing) return input;

  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-muted">
          {leading}
        </span>
      )}
      {input}
      {trailing && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-muted">
          {trailing}
        </span>
      )}
    </div>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export function Textarea({
  invalid,
  className,
  rows = 3,
  ...rest
}: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, "px-3 py-2.5 resize-y", className)}
      {...rest}
    />
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

/**
 * Select gan nguyen ban, CHI cho man cam ung (ban mobile): picker cua he dieu hanh
 * de bam hon moi danh sach tu dung. Tren desktop, bam vao van bung menu xam cua he
 * dieu hanh lac giua app, nen desktop dung <Listbox> (danh sach ngan) hoac
 * <Combobox> (tu ~10 muc, co tim).
 */
export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(CONTROL, HEIGHT, "appearance-none pr-9", className)}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
