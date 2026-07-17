import type { ReactNode } from "react";
import type { Viewport } from "next";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fbfcfa",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-earth realtor-theme realtor-backdrop -my-12 flex min-h-screen max-w-full items-center justify-center py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="realtor-elevated-panel rounded-2xl p-5 sm:p-6 md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
