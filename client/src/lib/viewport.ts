// Safari on iPhone ignores interactive-widget=resizes-content, so its keyboard covers the bottom
// of the page (the composer). This keeps --app-height at the visible height while it's open.

export function followKeyboard(): () => void {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return () => undefined;
  const root = document.documentElement;
  const update = () => {
    // Only when something (the keyboard) covers part of the layout; otherwise leave it at 100%.
    const covered = window.innerHeight - vv.height > 80;
    if (covered) {
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      // iOS scrolls the whole page up to show the field; the app sizes itself instead.
      if (window.scrollY) window.scrollTo(0, 0);
    } else {
      root.style.removeProperty("--app-height");
    }
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
}
