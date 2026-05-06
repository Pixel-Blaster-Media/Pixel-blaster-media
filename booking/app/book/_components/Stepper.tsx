import Link from "next/link";

import {
  stepCompleteness,
  WIZARD_STEPS,
  type StepId,
  type WizardState,
} from "@/lib/booking/wizard-state";

/**
 * Horizontal 4-step progress bar for the /book wizard. Each step is a
 * Link when reachable (prior steps are complete) and a muted span when
 * not. The current step is highlighted.
 *
 * On small screens the labels collapse to just the number; on larger
 * screens you see "1 · Services" style.
 */
export default function Stepper({
  current,
  state,
}: {
  current: StepId;
  state: WizardState;
}) {
  const completeness = stepCompleteness(state);
  const urlSuffix = buildQuerySuffix(state);

  return (
    <ol className="mb-8 flex items-center gap-1 overflow-x-auto md:gap-3">
      {WIZARD_STEPS.map((step, idx) => {
        const isCurrent = step.id === current;
        const isDone = isStepDone(step.id, completeness);
        const isReachable =
          step.id <= completeness.maxReachable;

        const chipClass = isCurrent
          ? "border-brand-light bg-brand/20 text-brand-light"
          : isDone
            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
            : isReachable
              ? "border-white/20 text-white/70 hover:border-white/40"
              : "border-white/10 text-white/30";

        const content = (
          <div
            className={
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
              chipClass
            }
          >
            <span
              className={
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] " +
                (isDone
                  ? "bg-emerald-400/20"
                  : isCurrent
                    ? "bg-brand-light/20"
                    : "bg-white/10")
              }
            >
              {isDone ? "✓" : step.id}
            </span>
            <span className="hidden md:inline">{step.label}</span>
          </div>
        );

        return (
          <li key={step.id} className="flex items-center gap-1 md:gap-3">
            {isReachable && !isCurrent ? (
              <Link
                href={step.path + urlSuffix}
                className="focus:outline-none focus:ring-2 focus:ring-brand-light/50 rounded-full"
              >
                {content}
              </Link>
            ) : (
              <span aria-current={isCurrent ? "step" : undefined}>
                {content}
              </span>
            )}
            {idx < WIZARD_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className="h-px w-4 flex-shrink-0 bg-white/15 md:w-8"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function isStepDone(
  step: StepId,
  c: ReturnType<typeof stepCompleteness>,
): boolean {
  if (step === 1) return c.step1;
  if (step === 2) return c.step2;
  if (step === 3) return c.step3;
  return false; // step 4 is the submit step; only "done" after redirect
}

function buildQuerySuffix(state: WizardState): string {
  // Reuse the shared serializer — but we only emit fields that are set.
  const params = new URLSearchParams();
  if (state.services.length) params.set("services", state.services.join(","));
  if (state.addOns.length) params.set("add_ons", state.addOns.join(","));
  if (state.streetAddress) params.set("address", state.streetAddress);
  if (state.unitNumber) params.set("unit", state.unitNumber);
  if (state.city) params.set("city", state.city);
  if (state.postalCode) params.set("postal", state.postalCode);
  if (state.squareFootage != null)
    params.set("sqft", String(state.squareFootage));
  if (state.isVacant) params.set("vacant", state.isVacant);
  if (state.includeBasement != null) {
    params.set("basement", state.includeBasement ? "1" : "0");
  }
  if (state.shotRequests.length) params.set("shots", state.shotRequests.join(","));
  if (state.shootNotes) params.set("shoot_notes", state.shootNotes);
  if (state.slot) params.set("slot", state.slot);
  const q = params.toString();
  return q ? `?${q}` : "";
}
