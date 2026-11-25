// The public text pages (terms, privacy, setup): plain HTML for search engines. This brings in the
// fonts and styles, and adds a Copy button to each command on the setup guide.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/700.css";
import "./welcome.css";
import "./doc.css";

for (const box of document.querySelectorAll<HTMLElement>(".code")) {
  const text = box.querySelector("code")?.textContent ?? "";
  const label = box.dataset.label ?? "Terminal";
  const bar = document.createElement("div");
  bar.className = "code-bar";
  const name = document.createElement("span");
  name.textContent = label;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy";
  btn.textContent = "Copy";
  btn.setAttribute("aria-label", `Copy: ${text.split("\n")[0].slice(0, 60)}`);
  const said = document.createElement("span");
  said.className = "sr-only";
  said.setAttribute("role", "status");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
      said.textContent = "Copied to the clipboard";
    } catch {
      // No clipboard access: select it so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(box.querySelector("code")!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      said.textContent = "Selected: press Command or Control and C to copy";
    }
    setTimeout(() => { btn.textContent = "Copy"; said.textContent = ""; }, 2000);
  });
  bar.append(name, btn, said);
  box.prepend(bar);
}
