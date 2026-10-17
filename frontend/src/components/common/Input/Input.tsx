import { forwardRef, useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import styles from './Input.module.css';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  tone?: 'default' | 'admin';
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-msg`} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type InputProps = FieldProps & InputHTMLAttributes<HTMLInputElement> & { rightSlot?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, tone = 'default', rightSlot, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <div className={styles.control}>
        <input
          ref={ref}
          id={inputId}
          className={[styles.input, styles[tone], error && styles.invalid, className]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${inputId}-msg` : undefined}
          {...rest}
        />
        {rightSlot && <div className={styles.rightSlot}>{rightSlot}</div>}
      </div>
    </Field>
  );
});

type TextareaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ label, hint, error, tone = 'default', id, ...rest }: TextareaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <textarea
        id={inputId}
        className={[styles.input, styles.textarea, styles[tone], error && styles.invalid]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={Boolean(error) || undefined}
        {...rest}
      />
    </Field>
  );
}

type SelectProps = FieldProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: { value: string; label: string }[];
    placeholder?: string;
  };

export function Select({
  label,
  hint,
  error,
  tone = 'default',
  id,
  options,
  placeholder,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <select
        id={inputId}
        className={[styles.input, styles.select, styles[tone], error && styles.invalid]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
