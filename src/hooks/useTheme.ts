import { useState } from "react";
import { growFrom } from "@/lib/transition";

export type Theme = "light" | "dark";
const KEY = "dssc-theme"; // also read by the inline script in index.html

const initial = (): Theme =>
  (document.documentElement.dataset.theme as Theme) ??
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked — theme still applies for this session */
    }
    const apply = () => {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    // The new theme spreads out from the toggle as a circle.
    growFrom(apply, { shape: "circle" });
  };

  return { theme, toggleTheme };
}
