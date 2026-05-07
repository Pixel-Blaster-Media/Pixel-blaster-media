import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-earth realtor-theme realtor-backdrop -mx-6 -my-12 flex min-h-screen items-center justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="realtor-elevated-panel rounded-2xl p-6 md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
