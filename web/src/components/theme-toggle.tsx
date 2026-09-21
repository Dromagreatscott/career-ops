"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/cn";

const KEY = "career-ops:theme";

type Mode = "light" | "dark" | "system";

const OPTIONS: Array<{ mode: Mode; label: string; Icon: typeof Sun }> = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "dark", label: "Dark", Icon: Moon },
];

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Read the persisted preference. Legacy/absent value == follow the OS (system),
 *  matching the pre-paint script in layout.tsx. */
function readMode(): Mode {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* ignore */
  }
  return "system";
}

/** Apply a mode to the document: toggle the `dark` class, keep the browser-chrome
 *  theme-color meta in sync, and let theme-reactive components re-read. Mirrors the
 *  pre-paint THEME_SCRIPT so first paint and later toggles never diverge. */
function applyMode(mode: Mode): void {
  const dark = mode === "dark" || (mode === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0a0a" : "#f7f6f3");
  window.dispatchEvent(new Event("themechange"));
}

/** Visible, accessible three-way theme control: Light · System · Dark.
 *  Persists to the existing `career-ops:theme` key; the pre-paint script applies
 *  the choice before first paint (no flash), so this only reflects + updates it. */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("system");
  // Until mounted we render no active highlight so SSR and first client render
  // match (the real theme is already applied pre-paint); the effect then reflects
  // the persisted choice — avoids any hydration mismatch.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMode(readMode());
  }, []);

  // While on "system", track OS changes live.
  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readMode() === "system") applyMode("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mounted]);

  function choose(next: Mode): void {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    applyMode(next);
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface/60 p-0.5", className)}
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = mounted && mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => choose(m)}
            aria-label={`${label} theme`}
            aria-pressed={active}
            title={`${label} theme`}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              active ? "bg-brand-soft text-brand-text" : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
