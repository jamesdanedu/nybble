import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/* ---------------------------------------------------------------------------
 * The whole component library. Deliberately tiny and deliberately not a
 * dependency: eight primitives cover every screen in this app, and a design
 * system would be more code than the app.
 *
 * Sizing rule of thumb throughout: tap targets are at least 40px high and text
 * is at least 15px, because half the users are on a shared iPad and the other
 * half are looking at a projector from the back of the room.
 * ------------------------------------------------------------------------ */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* --- layout ------------------------------------------------------------- */

export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 pb-24 pt-6">{children}</main>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-block text-sm text-muted hover:text-accent no-print"
        >
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<'div'>) {
  return (
    <div
      {...rest}
      className={cx('rounded-card border border-line bg-surface', className)}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('p-5 sm:p-6', className)}>{children}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* --- buttons ------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-[color:var(--accent-ink)] border-accent hover:brightness-110',
  secondary: 'bg-surface text-ink border-line hover:border-accent hover:text-accent',
  quiet: 'bg-transparent text-muted border-transparent hover:text-accent',
  danger: 'bg-surface text-danger border-[color:var(--danger)] hover:bg-[color:var(--danger-soft)]',
};

const BUTTON_BASE =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-4 ' +
  'text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  variant = 'primary',
  className,
  ...rest
}: { variant?: Variant } & ComponentProps<'button'>) {
  return <button {...rest} className={cx(BUTTON_BASE, VARIANT[variant], className)} />;
}

export function ButtonLink({
  variant = 'secondary',
  className,
  ...rest
}: { variant?: Variant } & ComponentProps<typeof Link>) {
  return <Link {...rest} className={cx(BUTTON_BASE, VARIANT[variant], className)} />;
}

/* --- form fields -------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[13.5px] text-muted">{hint}</p>}
    </div>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[16px] text-ink ' +
  'placeholder:text-muted focus:border-accent focus:outline-none';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  // 16px font size on purpose: anything smaller makes iOS Safari zoom on focus.
  return <input {...rest} className={cx(CONTROL, className)} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={cx(CONTROL, 'min-h-[110px] leading-relaxed', className)} />;
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={cx(CONTROL, 'pr-8', className)} />;
}

/* --- feedback ----------------------------------------------------------- */

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    info: 'border-line bg-raised text-ink',
    success: 'border-accent bg-accent-soft text-ink',
    warn: 'border-[color:var(--warn)] bg-warn-soft text-ink',
    error: 'border-[color:var(--danger)] bg-danger-soft text-ink',
  } as const;
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cx('rounded-card border px-4 py-3 text-[15px]', tones[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && 'mt-1', 'text-[15px] leading-relaxed')}>{children}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger';
}) {
  const tones = {
    neutral: 'border-line text-muted',
    accent: 'border-accent bg-accent-soft text-ink',
    warn: 'border-[color:var(--warn)] bg-warn-soft text-ink',
    danger: 'border-[color:var(--danger)] bg-danger-soft text-ink',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The screen for "nothing here yet". Every list in this app uses it, because a
 * blank page with no next action is the fastest way to lose a class.
 */
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardBody className="py-10 text-center">
        <p className="text-[17px] font-semibold">{title}</p>
        {children && <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">{children}</p>}
        {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
      </CardBody>
    </Card>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[13.5px] text-muted">{sub}</p>}
    </div>
  );
}
