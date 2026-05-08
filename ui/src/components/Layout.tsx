import type { ReactNode } from "react";
import { NavLink } from "./NavLink";

const navItems = ["Dashboard", "Board", "Runs", "Workflows", "Settings"] as const;

interface LayoutProps {
  page: string;
  onNavigate: (page: string) => void;
  children: ReactNode;
}

export function Layout({ page, onNavigate, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-line bg-white px-4 py-5 lg:block">
        <div className="mb-8 px-2">
          <div className="text-sm font-semibold text-ink">Owned Symphony</div>
          <div className="mt-1 text-xs text-muted">Operator Console</div>
        </div>
        <nav className="grid gap-1">
          {navItems.map((item) => (
            <NavLink key={item} active={item === page} onClick={() => onNavigate(item)}>
              {item}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-white/90 px-5 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-muted">Owned Symphony / Operator Console</div>
              <h1 className="text-lg font-semibold text-ink">{page}</h1>
              <div className="mt-0.5 text-xs text-muted">Local orchestrator status</div>
            </div>
            <div className="flex gap-1 overflow-auto lg:hidden">
              {navItems.map((item) => (
                <NavLink key={item} compact active={item === page} onClick={() => onNavigate(item)}>
                  {item}
                </NavLink>
              ))}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1480px] px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
