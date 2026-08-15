import type { ReactNode } from 'react';

/** A title like "1. Your account" renders its number as a badge. */
function splitStep(title: string): { step?: string; rest: string } {
  const match = /^(\d+)\.\s+(.*)$/.exec(title);
  return match?.[1] && match[2] ? { step: match[1], rest: match[2] } : { rest: title };
}

export function Card({
  title,
  subtitle,
  children,
  tone,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const { step, rest } = splitStep(title ?? '');
  return (
    <section className={`card ${tone && tone !== 'default' ? `card--${tone}` : ''}`}>
      {title ? (
        <h2 className="card__title">
          {step ? <span className="card__step" aria-hidden="true">{step}</span> : null}
          {rest}
        </h2>
      ) : null}
      {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete = 'off',
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <input
      className="input"
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
}) {
  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  tradeoff,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
  tradeoff?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'toggle--disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__body">
        <span className="toggle__label">{label}</span>
        {description ? <span className="toggle__description">{description}</span> : null}
        {tradeoff ? <span className="toggle__tradeoff">Trade-off: {tradeoff}</span> : null}
      </span>
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button className={`button button--${variant}`} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  );
}

export function Banner({ tone, title, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {title ? <strong className="banner__title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      <div className="details__body">{children}</div>
    </details>
  );
}
