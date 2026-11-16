/**
 * Script injected into every recorded page (a Playwright init script). It
 * changes only what the camera sees, never the app's behaviour:
 *
 * - a visible cursor (desktop) or touch dot (phone) that follows the real
 *   pointer events, with a ripple on every press;
 * - no scrollbars (like macOS overlay scrollbars), and no Next.js dev
 *   indicator on the dev server;
 * - a log of every toast shown, so a take with an error toast can be caught.
 *
 * Plain JavaScript in a string: tsx would otherwise wrap functions in
 * esbuild's `__name` helper, which doesn't exist in the page.
 */

const STYLE = `
  nextjs-portal, [data-nextjs-dev-tools-button], [data-next-badge-root] { display: none !important; }
  html, body, * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  #__vcursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
    width: 0; height: 0; transform: translate(-100px, -100px); will-change: transform; }
  #__vcursor svg { position: absolute; left: -3px; top: -2px; filter: drop-shadow(0 1px 1.5px rgba(40,25,15,.35)); }
  #__vcursor .dot { position: absolute; left: -19px; top: -19px; width: 38px; height: 38px; border-radius: 50%;
    background: rgba(60, 35, 25, .28); border: 2px solid rgba(255,255,255,.85); opacity: 0; transition: opacity .12s; }
  #__vcursor.down .dot { opacity: 1; }
  .__vripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px;
    border-radius: 50%; border: 3px solid rgba(139, 45, 38, .85); background: rgba(139, 45, 38, .18);
    animation: __vripple .55s cubic-bezier(.2,.7,.3,1) forwards; }
  @keyframes __vripple { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
`;

const ARROW =
  '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L8.6 18.8 L12.4 27.4 L16.4 25.6 L12.7 17.3 L20.4 17 Z" fill="#231a15" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

const BODY = `
  var install = function () {
    if (document.getElementById("__vcursor")) return;
    var style = document.createElement("style");
    style.textContent = STYLE;
    document.documentElement.appendChild(style);
    var cursor = document.createElement("div");
    cursor.id = "__vcursor";
    cursor.innerHTML = KIND === "touch" ? '<div class="dot"></div>' : ARROW;
    document.documentElement.appendChild(cursor);
    var place = function (x, y) {
      window.__vpos = [x, y];
      cursor.style.transform = "translate(" + x + "px, " + y + "px)";
    };
    try {
      var saved = sessionStorage.getItem("__vpos");
      if (saved && KIND === "mouse") { var p = JSON.parse(saved); place(p[0], p[1]); }
    } catch (e) {}
    addEventListener("pointermove", function (e) { place(e.clientX, e.clientY); }, { capture: true, passive: true });
    addEventListener("pointerdown", function (e) {
      place(e.clientX, e.clientY);
      cursor.classList.add("down");
      var r = document.createElement("div");
      r.className = "__vripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(function () { r.remove(); }, 700);
    }, { capture: true, passive: true });
    var up = function () { cursor.classList.remove("down"); };
    addEventListener("pointerup", up, { capture: true, passive: true });
    addEventListener("pointercancel", up, { capture: true, passive: true });
    addEventListener("pagehide", function () {
      try { if (window.__vpos) sessionStorage.setItem("__vpos", JSON.stringify(window.__vpos)); } catch (e) {}
    });

    var seen = new WeakSet();
    var log = [];
    window.__vtoasts = log;
    new MutationObserver(function () {
      document.querySelectorAll("[data-sileo-toast]").forEach(function (el) {
        if (seen.has(el)) return;
        var t = el.querySelector("[data-sileo-title]");
        var title = t ? t.textContent : "";
        if (!title) return;
        seen.add(el);
        log.push({ title: title, state: el.getAttribute("data-state"), t: Date.now() });
      });
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
`;

export function pageDecorScript(kind: "mouse" | "touch") {
  return `(function () {
    var KIND = ${JSON.stringify(kind)};
    var STYLE = ${JSON.stringify(STYLE)};
    var ARROW = ${JSON.stringify(ARROW)};
    ${BODY}
  })();`;
}
