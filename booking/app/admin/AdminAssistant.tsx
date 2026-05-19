"use client";

import Link from "next/link";
import {
  type PointerEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  askAdminAssistant,
  confirmAdminAssistantAction,
  type AdminAssistantAction,
  type AdminAssistantResult,
} from "./assistant/actions";

const EXAMPLES = [
  "What shoots do I have tomorrow?",
  "Cancel Bob's booking today at 3:30",
  "Find Sarah's last booking",
];

export default function AdminAssistant() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AdminAssistantResult | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [bubblePosition, setBubblePosition] = useState({
    right: 20,
    bottom: 24,
  });
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);
  const ignoreClickRef = useRef(false);

  function ask(input = prompt) {
    const value = input.trim();
    if (!value) return;
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await askAdminAssistant(value));
      } catch (err) {
        setResult({
          ok: false,
          kind: "unsupported",
          message: err instanceof Error ? err.message : "Assistant failed.",
          actions: [],
        });
      }
    });
  }

  function confirm(action: AdminAssistantAction) {
    setConfirming(action.bookingId);
    startTransition(async () => {
      try {
        setResult(await confirmAdminAssistantAction(action));
      } catch (err) {
        setResult({
          ok: false,
          kind: "unsupported",
          message: err instanceof Error ? err.message : "Action failed.",
          actions: [],
        });
      } finally {
        setConfirming(null);
      }
    });
  }

  function startBubbleDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startRight: bubblePosition.right,
      startBottom: bubblePosition.bottom,
      moved: false,
    };
  }

  function moveBubble(event: PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setBubblePosition({
      right: clamp(
        dragRef.current.startRight - dx,
        12,
        Math.max(12, window.innerWidth - 70),
      ),
      bottom: clamp(
        dragRef.current.startBottom - dy,
        12,
        Math.max(12, window.innerHeight - 82),
      ),
    });
  }

  function stopBubbleDrag() {
    if (dragRef.current?.moved) {
      ignoreClickRef.current = true;
    }
    dragRef.current = null;
  }

  function openBubble() {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    setAssistantOpen(true);
  }

  const panel = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            Pixel Assistant
          </p>
          <h2 className="mt-1 text-lg font-semibold text-realtor-text">
            Ask me to find, plan, or prepare admin work
          </h2>
          <p className="mt-1 text-xs text-realtor-muted">
            Anything that changes a booking asks for confirmation first.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/30 bg-realtor-primary/10 px-3 py-1 text-[11px] font-semibold text-realtor-primary">
          AI beta
        </span>
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder='Try "cancel Bob’s booking today at 3:30"'
          className="min-h-11 flex-1 rounded-full border border-realtor-primary/15 bg-realtor-surface px-4 text-sm text-realtor-text outline-none transition placeholder:text-realtor-muted focus:border-realtor-primary/50 focus:ring-2 focus:ring-realtor-primary/15"
        />
        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Thinking..." : "Ask"}
        </button>
      </form>

      {!result ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setPrompt(example);
                ask(example);
                setAssistantOpen(true);
              }}
              className="rounded-full border border-realtor-primary/15 bg-realtor-surface/70 px-3 py-1.5 text-xs text-realtor-muted transition hover:border-realtor-primary/45 hover:text-realtor-primary"
            >
              {example}
            </button>
          ))}
        </div>
      ) : (
        <AssistantResult
          result={result}
          confirming={confirming}
          onConfirm={confirm}
        />
      )}
    </>
  );

  return (
    <>
      {assistantOpen ? (
        <section
          className="fixed inset-x-3 z-[80] max-h-[78vh] overflow-y-auto rounded-2xl border border-realtor-primary/20 bg-[#fffdf8] p-4 text-realtor-text shadow-2xl shadow-realtor-text/25 md:inset-x-auto md:right-6 md:w-[440px]"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.75rem)",
          }}
        >
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setAssistantOpen(false)}
              className="rounded-full border border-realtor-primary/15 px-3 py-1 text-xs font-semibold text-realtor-muted hover:text-realtor-primary"
            >
              Close
            </button>
          </div>
          {panel}
        </section>
      ) : null}

      {!assistantOpen ? (
        <button
          type="button"
          onPointerDown={startBubbleDrag}
          onPointerMove={moveBubble}
          onPointerUp={stopBubbleDrag}
          onPointerCancel={stopBubbleDrag}
          onClick={openBubble}
          className="fixed z-[80] flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border border-realtor-primary/20 bg-realtor-primary text-lg font-bold text-white shadow-2xl shadow-realtor-text/30 transition hover:scale-105 hover:bg-realtor-primary-light"
          style={{
            right: bubblePosition.right,
            bottom: bubblePosition.bottom,
          }}
          aria-label="Open Pixel Assistant"
        >
          AI
        </button>
      ) : null}
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function AssistantResult({
  result,
  confirming,
  onConfirm,
}: {
  result: AdminAssistantResult;
  confirming: string | null;
  onConfirm: (action: AdminAssistantAction) => void;
}) {
  return (
    <div
      className={`mt-4 rounded-2xl border p-3 ${
        result.ok
          ? "border-brand/25 bg-brand/10"
          : "border-amber-400/30 bg-amber-400/10"
      }`}
    >
      <p className="whitespace-pre-wrap text-sm text-realtor-text">
        {result.message}
      </p>
      {result.actions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {result.actions.map((action) => (
            <div
              key={`${action.type}:${action.bookingId}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-realtor-primary/12 bg-realtor-surface/80 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-realtor-text">
                  {action.label}
                </p>
                <p className="mt-0.5 text-xs text-realtor-muted">
                  {action.details}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={action.href}
                  className="rounded-full border border-realtor-primary/15 px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/5"
                >
                  Open
                </Link>
                {action.requiresConfirmation ? (
                  <button
                    type="button"
                    disabled={Boolean(confirming)}
                    onClick={() => onConfirm(action)}
                    className="rounded-full border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-500 disabled:opacity-60"
                  >
                    {confirming === action.bookingId
                      ? "Running..."
                      : action.type === "create_booking"
                        ? "Confirm booking"
                        : action.type === "send_delivery_email"
                          ? "Send email"
                          : action.type === "update_booking_status"
                            ? "Update status"
                            : "Confirm"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
