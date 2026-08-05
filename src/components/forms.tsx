import Link from "next/link";
import type { ReactNode } from "react";

/* Plain server-rendered forms posting to server actions. No client JS. */

export function FormBlock({
  label,
  title,
  hint,
  children,
}: {
  label: string;
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 border-t border-rule pt-6">
      <div className="mb-5">
        <div className="label label-ink">{label}</div>
        {title && <p className="mt-1.5 text-[14px] text-ink-2">{title}</p>}
        {hint && <p className="writing mt-2 text-[13px]">{hint}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Row({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-6 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>
  );
}

export function TextField({
  label,
  name,
  placeholder,
  hint,
  required,
  defaultValue,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string | number;
  type?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-1 text-ink-4">·  required</span>}
      </span>
      <input
        className="field mt-1 text-[14px]"
        name={name}
        type={type}
        step={step}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
      {hint && <span className="mt-1.5 block text-[11.5px] leading-snug text-ink-4">{hint}</span>}
    </label>
  );
}

/** The main writing surface. Serif, roomy — this is where thinking happens. */
export function Prose({
  label,
  name,
  placeholder,
  hint,
  rows = 4,
  required,
  defaultValue,
  big,
}: {
  label: string;
  name: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  required?: boolean;
  defaultValue?: string;
  big?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-1 text-ink-4">·  required</span>}
      </span>
      {hint && <span className="mt-1 block max-w-[68ch] text-[12px] leading-snug text-ink-3">{hint}</span>}
      <textarea
        className={`field-box mt-2 ${big ? "text-[17px]!" : ""}`}
        name={name}
        rows={rows}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
    </label>
  );
}

/** One item per line. Used for assumptions, catalysts, risks, falsifiers. */
export function ListField({
  label,
  name,
  placeholder,
  hint,
  rows = 4,
  defaultValue,
}: {
  label: string;
  name: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  defaultValue?: string[];
}) {
  return (
    <Prose
      label={label}
      name={name}
      rows={rows}
      placeholder={placeholder}
      hint={hint ? `${hint} One per line.` : "One per line."}
      defaultValue={defaultValue?.join("\n")}
    />
  );
}

export function ChipRadio({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {hint && <p className="mt-1 max-w-[68ch] text-[12px] leading-snug text-ink-3">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o.value} className="chip">
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={defaultValue ? defaultValue === o.value : false}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ConfidencePicker({
  name = "confidence",
  defaultValue = 3,
  label = "Confidence",
  hint = "How much you would bet on being right, not how much you like the idea. Recorded so it can be checked against outcomes later.",
}: {
  name?: string;
  defaultValue?: number;
  label?: string;
  hint?: string;
}) {
  const captions = ["Low", "", "Moderate", "", "High"];
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <p className="mt-1 max-w-[68ch] text-[12px] leading-snug text-ink-3">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="chip num min-w-[52px] justify-center gap-1.5">
            <input type="radio" name={name} value={n} defaultChecked={n === defaultValue} />
            {n}
            {captions[n - 1] && (
              <span className="font-sans text-[10px] uppercase tracking-wider opacity-70">
                {captions[n - 1]}
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function VerdictPicker({
  label,
  name,
  hint,
  defaultValue = "partly",
}: {
  label: string;
  name: string;
  hint?: string;
  defaultValue?: string;
}) {
  return (
    <ChipRadio
      label={label}
      name={name}
      hint={hint}
      defaultValue={defaultValue}
      options={[
        { value: "yes", label: "Yes" },
        { value: "partly", label: "Partly" },
        { value: "no", label: "No" },
      ]}
    />
  );
}

export function SubmitBar({
  label,
  cancelHref,
  note,
}: {
  label: string;
  cancelHref: string;
  note?: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-10 flex flex-wrap items-center gap-4 border-t border-rule bg-paper/95 px-6 py-4 backdrop-blur sm:-mx-10 sm:px-10">
      {/* data-primary-submit marks the form's real action, so a secondary form on
          the page (search, filters) is never mistaken for it. */}
      <button type="submit" data-primary-submit className="btn btn-solid">
        {label}
      </button>
      <Link href={cancelHref} className="btn btn-quiet">
        Cancel
      </Link>
      {note && <p className="max-w-[54ch] text-[11.5px] leading-snug text-ink-3">{note}</p>}
    </div>
  );
}

export function todayValue() {
  return new Date().toISOString().slice(0, 10);
}
