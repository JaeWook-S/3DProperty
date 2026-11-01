// Relative dragging keeps the same precision for a 19- or 38-storey building.
// Native range keyboard events (arrows, Home/End) remain available.
export function installFloorControl({ input, down, up, onChange }) {
  const pixelsPerFloor = 24;
  let drag = null;
  const change = (value) => onChange(Math.max(Number(input.min), Math.min(Number(input.max), value)));

  input.addEventListener('input', () => change(Number(input.value)));
  // Native touch range behavior otherwise jumps before relative dragging starts.
  input.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  down.addEventListener('click', () => change(Number(input.value) - 1));
  up.addEventListener('click', () => change(Number(input.value) + 1));
  input.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    input.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, x: event.clientX };
    input.classList.add('dragging');
  });
  input.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const steps = Math.trunc((event.clientX - drag.x) / pixelsPerFloor);
    if (!steps) return;
    const current = Number(input.value);
    const next = Math.max(Number(input.min), Math.min(Number(input.max), current + steps));
    drag.x = next === current || next === Number(input.min) || next === Number(input.max)
      ? event.clientX : drag.x + steps * pixelsPerFloor;
    if (next !== current) change(next);
  });
  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    input.classList.remove('dragging');
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) input.addEventListener(name, end);
}
