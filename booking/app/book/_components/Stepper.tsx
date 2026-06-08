import Link from "next/link";

import {
  serializeWizardState,
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
    <ol className="mb-4 flex items-center gap-1 overflow-x-auto rounded-full border border-realtor-primary/20 bg-white p-1 shadow-sm shadow-realtor-primary/5 md:mb-8 md:gap-2">
      {WIZARD_STEPS.map((step, idx) => {
        const isCurrent = step.id === current;
        const isDone = isStepDone(step.id, completeness);
        const isReachable =
          step.id <= completeness.maxReachable;

        const chipClass = isCurrent
          ? "border-realtor-primary bg-realtor-primary text-white shadow-sm shadow-realtor-primary/20"
          : isDone
            ? "border-realtor-primary/35 bg-realtor-surface-muted/45 text-realtor-primary"
            : isReachable
              ? "border-transparent text-realtor-text/72 hover:bg-realtor-surface-muted/45 hover:text-realtor-text"
              : "border-realtor-primary/15 text-realtor-text/40";

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
                  ? "bg-realtor-primary/15"
                  : isCurrent
                    ? "bg-white/15"
                    : "bg-realtor-surface-muted/70")
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
                className="rounded-full focus:outline-none focus:ring-2 focus:ring-realtor-primary/35"
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
                className="h-px w-3 flex-shrink-0 bg-realtor-primary/12 md:w-6"
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
  const params = serializeWizardState(state);
  const q = params.toString();
  return q ? `?${q}` : "";
}
