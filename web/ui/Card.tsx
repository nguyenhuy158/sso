import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Bo dem san ben trong. Tat khi con la danh sach tu ke vien. */
  padded?: boolean;
};

export function Card({
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-ui border border-border-subtle bg-surface",
        padded && "p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Nut hoac menu ben phai tieu de. */
  action?: ReactNode;
  className?: string;
};

export function CardHeader({
  title,
  description,
  action,
  className,
}: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-fg">{title}</h3>
        {description && (
          <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** O so lieu: nhan o tren, con so lon o duoi. Dung le hoac boc trong MetricGroup. */
export function Metric({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="rounded-ui border border-border-subtle bg-surface p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight text-fg tabular">
        {value}
      </p>
    </div>
  );
}

/**
 * Nhieu Metric cung mot khung, chia bang vach thay vi moi o mot card. Mobile xep
 * mot cot, tu sm tro len xep mot hang chia deu. Metric con bo vien va bo goc rieng.
 */
export function MetricGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 divide-y divide-border-subtle overflow-hidden rounded-ui border border-border-subtle bg-surface",
        "sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0",
        "[&>*]:rounded-none [&>*]:border-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
