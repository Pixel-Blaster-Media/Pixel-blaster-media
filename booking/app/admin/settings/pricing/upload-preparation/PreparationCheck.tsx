"use client";

import { useEffect, useRef, useState } from "react";
import { PREPARATION_CHECK_OPERATION, PREPARATION_CHECK_STORAGE, preparationCheckReport,
  readPreparationCheckReport, type PreparationCheckReport } from "@/lib/booking/catalog-preparation-check";

type Props = { title: string; catalogItemId: string; size: number; fingerprint: string; alreadyAttempted: boolean };
type Phase = "checking" | "ready" | "running" | "complete" | "locked" | "unavailable";
const stageNames: Record<string, string> = {
  provider_create: "Cloudflare reservation", capability_validation: "Upload address validation",
  provider_read: "Cloudflare reservation lookup", restriction_verification: "Upload safety checks",
};

export default function PreparationCheck(props: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [report, setReport] = useState<PreparationCheckReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const attempted = useRef(props.alreadyAttempted);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREPARATION_CHECK_STORAGE);
      const restored = readPreparationCheckReport(saved);
      attempted.current = props.alreadyAttempted || saved !== null;
      setReport(restored);
      setPhase(restored ? "complete" : attempted.current ? "locked" : "ready");
    } catch { attempted.current = true; setPhase("unavailable"); }
  }, [props.alreadyAttempted]);

  const run = async () => {
    if (attempted.current || phase !== "ready") return;
    attempted.current = true;
    try {
      if (localStorage.getItem(PREPARATION_CHECK_STORAGE) !== null) { setPhase("locked"); return; }
      // Written before the only request; an uncertain outcome must never enable a retry.
      localStorage.setItem(PREPARATION_CHECK_STORAGE, "attempt-started-no-retry");
    } catch { setPhase("unavailable"); return; }
    setPhase("running");
    let result: PreparationCheckReport;
    try {
      const response = await fetch("/api/admin/catalog-examples/upload", {
        method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol: "tus", catalogItemId: props.catalogItemId, title: props.title,
          description: "", size: props.size, fingerprint: props.fingerprint, idempotencyKey: PREPARATION_CHECK_OPERATION }),
        signal: AbortSignal.timeout(45_000),
      });
      // Never retain, show, follow or pass the returned upload URL to a transport.
      result = preparationCheckReport(await response.json(), response.status);
    } catch { result = preparationCheckReport(null, null); }
    setReport(result); setPhase("complete");
    try { localStorage.setItem(PREPARATION_CHECK_STORAGE, JSON.stringify(result)); } catch { /* Keep the in-memory attempt lock. */ }
  };
  const copyReport = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <div className="space-y-5 rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-6">
    <div><h2 className="text-lg font-semibold">{props.title}</h2><p className="mt-1 text-sm text-realtor-muted">Original file: {(props.size / 1_000_000).toFixed(1)} MB</p></div>
    <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
      <li>One preparation request, using up to 10 minutes of your existing Stream allowance. Confirm that capacity is available before starting.</li>
      <li>No video file is needed and no video bytes will be sent.</li>
      <li>No payment or plan changes. The test will not retry or start another copy.</li>
    </ul>
    {phase === "checking" ? <p role="status" className="text-sm">Checking whether this test has already run…</p> : null}
    {phase === "ready" || phase === "running" ? <button type="button" disabled={phase === "running"}
      onClick={() => void run()} className="tap-target rounded-full bg-realtor-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
      {phase === "running" ? "Checking preparation…" : "Run new preparation test"}</button> : null}
    {phase === "running" ? <p role="status" className="text-sm">Keep this page open. Only preparation metadata is being sent.</p> : null}
    {phase === "locked" ? <p role="status" className="text-sm">This test has already been attempted. It cannot run again. Share this message so the existing operation can be reviewed.</p> : null}
    {phase === "unavailable" ? <p role="alert" className="text-sm">Your browser could not save the one-attempt lock. No preparation request was sent. Share this message for help.</p> : null}
    {report ? <div className="space-y-3 border-t border-realtor-primary/15 pt-5">
      <p role="status" className="font-semibold">{report.prepared === true ? "Preparation succeeded. No video was uploaded."
        : report.prepared === false ? "Preparation failed. No video was uploaded." : "The result could not be confirmed. Do not start another test."}</p>
      {report.inspection ? <p className="text-sm">Stopped at: {stageNames[report.inspection.stage]}.</p> : null}
      <p className="text-sm text-realtor-muted">Share the safe report below so this operation can be reviewed.</p>
      <button type="button" onClick={() => void copyReport()} className="tap-target rounded-full border border-realtor-primary/20 px-4 py-2 text-sm">{copied ? "Report copied" : "Copy safe report"}</button>
      {copyFailed ? <p role="alert" className="text-sm">Copy is unavailable. You can share a screenshot of the report below.</p> : null}
      <details><summary className="cursor-pointer text-sm">View safe report</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-realtor-primary/5 p-4 text-xs">{JSON.stringify(report, null, 2)}</pre></details>
    </div> : null}
  </div>;
}
