// The public welcome page (welcome.html) is plain HTML so search engines can read it; this only
// brings in its fonts and styles, and sends an installed app straight on to signing in.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "./welcome.css";
import { isInstalledApp } from "../lib/signin";

// A Home Screen, Dock or Mac app isn't a visitor: it goes to the app's own sign-in, which hands the
// session over from the browser (and keeps ?app= so each app only lets in its own person).
const native = (globalThis as { __KITH_APP__?: unknown }).__KITH_APP__;
if (isInstalledApp() || native === "child" || native === "parent") {
  location.replace(`/signin${location.search}`);
}
