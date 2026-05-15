import { startAppleOAuth, startGoogleOAuth } from "./actions";

export default function OAuthButtons({
  mode,
  next = "/admin",
}: {
  mode: "signup" | "sign-in";
  next?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-realtor-muted">
        <span className="h-px flex-1 bg-realtor-primary/15" />
        <span>or</span>
        <span className="h-px flex-1 bg-realtor-primary/15" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <OAuthForm
          action={startGoogleOAuth}
          label="Continue with Google"
          mode={mode}
          next={next}
        />
        <OAuthForm
          action={startAppleOAuth}
          label="Continue with Apple"
          mode={mode}
          next={next}
        />
      </div>
    </div>
  );
}

function OAuthForm({
  action,
  label,
  mode,
  next,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  mode: "signup" | "sign-in";
  next: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        className="w-full rounded-full border border-realtor-primary/20 bg-realtor-surface px-4 py-2.5 text-sm font-semibold text-realtor-text transition hover:border-realtor-primary/45 hover:bg-white"
      >
        {label}
      </button>
    </form>
  );
}
