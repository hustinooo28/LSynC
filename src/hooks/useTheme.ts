import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "dssc-theme"; // also read by the inline script in index.html

const initial = (): Theme =>
  (document.documentElement.dataset.theme as Theme) ??
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage blocked — theme still applies for this session */
      }
      return next;
    });

  return { theme, toggleTheme };
}
