// The key bar under the terminal, for phones: Esc, Ctrl, Tab and the arrows.
// The terminal is ttyd's own page in a same-origin frame. ttyd puts its xterm.js
// terminal on window.term, and term.input() sends keys as if they were typed.
const frame = document.getElementById("term");
const SEQ = { esc: "\x1b", tab: "\t", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D" };
const ctrlButton = document.querySelector('#keys [data-key="ctrl"]');
let ctrl = false;

const term = () => frame.contentWindow && frame.contentWindow.term;

function setCtrl(on) {
  ctrl = on;
  ctrlButton.classList.toggle("armed", on);
}

// Ctrl and a letter: the control character, as a real keyboard sends it.
function ctrlChar(ch) {
  if (ch === " ") return "\x00";
  if (ch === "?") return "\x7f";
  const c = ch.toUpperCase().charCodeAt(0);
  return c >= 64 && c <= 95 ? String.fromCharCode(c - 64) : ch;
}

document.querySelectorAll("#keys button").forEach((b) => {
  // Keep the focus (and the phone's keyboard) in the terminal.
  b.addEventListener("pointerdown", (e) => e.preventDefault());
  b.addEventListener("click", () => {
    const t = term();
    if (!t) return;
    if (b.dataset.key === "ctrl") {
      setCtrl(!ctrl);
    } else {
      t.input(SEQ[b.dataset.key]);
      setCtrl(false);
    }
    t.focus();
  });
});

// With Ctrl on, the next typed character becomes a control character. These run
// in the capture phase, before xterm.js sees the key. A phone keyboard often
// sends no usable keydown, so beforeinput covers it.
frame.addEventListener("load", () => {
  const doc = frame.contentDocument;
  const take = (e, ch) => {
    if (!ctrl || !ch || ch.length !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setCtrl(false);
    term().input(ctrlChar(ch));
  };
  doc.addEventListener("keydown", (e) => take(e, e.key), true);
  doc.addEventListener("beforeinput", (e) => take(e, e.data), true);
});
