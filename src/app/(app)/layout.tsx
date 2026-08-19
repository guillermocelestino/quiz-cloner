import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <TopNav />
      {children}
    </div>
  );
}
