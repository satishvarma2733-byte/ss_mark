"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const EVENT = "ss-theme-change";

// The theme is applied before first paint by the inline script in app/layout.tsx; this reads what it set.
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") return applied;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// One toggle sits in the customer header and one in each portal top bar; they stay in step through a window event.
export function ThemeToggle({ className = "nav-icon theme-toggle" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("ss-theme", next);
    } catch {
      // Storage can be blocked (private mode); the choice then lasts for this page only.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
