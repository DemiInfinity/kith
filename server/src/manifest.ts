// The web app manifest, per session: "Kith Parent" when signed in as the parent, "Kith" otherwise.
// Installing to the Dock or Home Screen after signing in then gets the right name (an installed
// app keeps the name it was installed with).

export function manifestFor(role: "child" | "parent" | null) {
  const parent = role === "parent";
  return {
    name: parent ? "Kith Parent" : "Kith",
    short_name: parent ? "Kith Parent" : "Kith",
    description: parent ? "The grown-up's view of Kith." : "Your companion, kept at home.",
    // An installed parent app opens on the parent view.
    start_url: parent ? "/?app=parent" : "/?app=child", // the app remembers which one it is
    id: parent ? "/parent" : "/",
    scope: "/",
    display: "standalone",
    orientation: parent ? "any" : "portrait",
    background_color: "#1C1219",
    theme_color: "#1C1219",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
