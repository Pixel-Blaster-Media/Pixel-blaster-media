import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="realtor-theme mx-auto max-w-md">
      <div className="realtor-elevated-panel rounded-2xl p-6 md:p-8">
        {children}
      </div>
    </div>
  );
}
