import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement the Pointer Capture APIs at all — any component
// using onPointerDown/setPointerCapture (e.g. drag gestures) throws
// "... is not a function" under RTL's fireEvent.pointerDown without this.
// No-op stubs are enough: tests only need the calls to not throw, not to
// model real capture semantics.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
