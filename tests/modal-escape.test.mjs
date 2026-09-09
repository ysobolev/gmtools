import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Exercise the hook's actual event listener with a minimal effect/ref harness.
const effects = [];
globalThis.modalTestEffects = effects;
const { outputFiles } = await build({
  entryPoints: ["src/extension/use-modal-escape.ts"], bundle: true,
  format: "esm", platform: "node", write: false,
  plugins: [{ name: "react-hooks", setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "hooks" }));
    build.onLoad({ filter: /.*/, namespace: "hooks" }, () => ({ contents:
      "export const useRef = current => ({ current }); export const useEffect = fn => globalThis.modalTestEffects.push(fn);" }));
  } }],
});
const { useModalEscape } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("Escape closes only the top idle modal, respects native dialogs, and cleans up", () => {
  const listeners = new Set();
  const top = {};
  let nativeOpen = false;
  globalThis.window = {
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  globalThis.document = {
    querySelector: () => nativeOpen ? {} : null,
    querySelectorAll: () => ({ length: 1, item: () => top }),
  };
  let closed = 0;
  function mount(open, busy, node = top) {
    const ref = useModalEscape(open, busy, () => closed++);
    ref.current = node;
    return effects.shift()();
  }
  function key(overrides = {}) {
    const event = { key: "Escape", defaultPrevented: false, isComposing: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...overrides };
    for (const listener of listeners) listener(event);
  }
  assert.equal(mount(false, false), undefined);
  assert.equal(listeners.size, 0);
  const removeLower = mount(true, false, {});
  const removeBusy = mount(true, true);
  key();
  assert.equal(closed, 0);
  removeBusy();
  const removeTop = mount(true, false);
  key({ key: "Enter" }); key({ defaultPrevented: true }); key({ isComposing: true });
  nativeOpen = true; key(); nativeOpen = false;
  assert.equal(closed, 0);
  key();
  assert.equal(closed, 1);
  removeTop(); removeLower();
  assert.equal(listeners.size, 0);
  delete globalThis.window;
  delete globalThis.document;
});
