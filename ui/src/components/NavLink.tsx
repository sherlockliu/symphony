import type { ReactNode } from "react";

interface NavLinkProps {
  active: boolean;
  compact?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function NavLink({ active, compact = false, onClick, children }: NavLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md text-left text-sm font-medium transition",
        compact ? "px-3 py-1.5" : "px-3 py-2",
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
      ].join(" ")}
    >
      {children}
    </button>
  );
}
