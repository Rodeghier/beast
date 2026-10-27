"use client";

import { useId } from "react";

export function InputSection({ title, description, children, initiallyOpen = false, className = "" }: {
  title: string; description?: string; children: React.ReactNode; initiallyOpen?: boolean; className?: string;
}) {
  return <details className={`input-section ${className}`} open={initiallyOpen || undefined}
    onInvalidCapture={event => { event.currentTarget.open = true; }}>
    <summary><span>{title}</span>{description && <small>{description}</small>}</summary>
    <div className="input-section-body">{children}</div>
  </details>;
}

export function InputModeChoice({ custom, onChange, disabled = false }: {
  custom: boolean; onChange: (custom: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="input-mode" role="radiogroup" aria-label="Input values">
    <label><input type="radio" name={id} checked={!custom} disabled={disabled} onChange={() => onChange(false)}/>Use defaults</label>
    <label><input type="radio" name={id} checked={custom} disabled={disabled} onChange={() => onChange(true)}/>Modify values</label>
  </div>;
}
