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
    } else if (shortStandalone()) {
      // iOS home-screen apps sometimes size the page shorter than the screen (by about the status
      // bar), leaving a gap under the tab bar. Fill the whole screen instead.
      const full = fullScreenHeight();
      root.style.setProperty("--app-height", `${full}px`);
      root.style.height = `${full}px`;
      document.body.style.height = `${full}px`;
    } else {
      root.style.removeProperty("--app-height");
      root.style.removeProperty("height");
      document.body.style.removeProperty("height");
    }
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
}

const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
/** The screen's height in the current orientation (iOS keeps screen.width/height in portrait). */
const fullScreenHeight = () => (matchMedia("(orientation: portrait)").matches ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height));
/** A home-screen app on a phone whose page is a little shorter than the screen (not the keyboard). */
function shortStandalone(): boolean {
  if (!standalone() || !/iPhone|iPod/.test(navigator.userAgent)) return false;
  const gap = fullScreenHeight() - window.innerHeight;
  return gap > 0 && gap < 120;
}
