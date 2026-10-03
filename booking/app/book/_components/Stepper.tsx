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
 * Labels remain visible and accessible at every viewport size.
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
    <ol className="booking-refresh-steps" aria-label="Booking progress">
      {WIZARD_STEPS.map((step) => {
        const isCurrent = step.id === current;
        const isDone = isStepDone(step.id, completeness);
        const isReachable = step.id <= completeness.maxReachable;
        const content = (
          <>
            <span className="booking-refresh-step-number" aria-hidden="true">
              {isDone && !isCurrent ? "✓" : step.id}
            </span>
            <span>{step.label}</span>
          </>
        );
        return (
          <li key={step.id} data-current={isCurrent} data-done={isDone}>
            {isReachable && !isCurrent ? (
              <Link href={step.path + urlSuffix}>{content}</Link>
            ) : (
              <span aria-current={isCurrent ? "step" : undefined}>{content}</span>
            )}
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
