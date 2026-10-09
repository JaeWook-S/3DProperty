import { Euler, EventDispatcher } from 'three';
import { applyLook, clampOffset, isTap, lookSensitivity, stickDirection, stickInput } from './touch-input.js';
import './touch-walk.css';

// On-screen walking controls for phones and tablets.
//
// Shaped like three's PointerLockControls so the viewer can treat both alike:
// lock()/unlock(), isLocked and 'lock' / 'unlock' / 'change' events. While locked,
// a full-screen layer takes every touch: the bottom-left stick sets `forward` and
// `right` (read by the viewer's movement loop), a drag anywhere else turns the
// camera, a quick tap reports its position to onTap, and the action button calls
// onAction. Mouse pointers drive the same layer, which keeps it usable where
// Pointer Lock is missing and lets ?input=touch be tried on a desktop.

const euler = new Euler(0, 0, 0, 'YXZ');
/** Knob travel for full speed, as a fraction of the stick's diameter. */
const STICK_TRAVEL = 0.38;
const HINT_MS = 5000;
const FULLSCREEN_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/></svg>';
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Phones and tablets without a mouse: show touch guidance instead of keyboard keys. */
export function isTouchFirst() {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export class TouchWalkControls extends EventDispatcher {
  constructor(camera, { surface = null, onTap = () => {}, onAction = () => {}, minPolarAngle = 0, maxPolarAngle = Math.PI } = {}) {
    super();
    Object.assign(this, { camera, surface, onTap, onAction, minPolarAngle, maxPolarAngle });
    this.isLocked = false;
    this.forward = 0;
    this.right = 0;
    this.stick = null;
    this.look = null;
    this.lastPointerType = null;
    this.actionText = '';
    this.hintShown = false;
    const input = new URLSearchParams(location.search).get('input');
    this.forced = ['touch', 'mouse'].includes(input) ? input : null;
    this.listeners = new AbortController();
    this.element = this.build();
    document.body.append(this.element);
    this.listen(this.listeners.signal);
  }

  /** Whether the next walk should use these controls instead of Pointer Lock. */
  preferred() {
    if (this.forced) return this.forced === 'touch';
    if (this.lastPointerType) return this.lastPointerType !== 'mouse';
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  lock() {
    if (this.isLocked) return;
    this.isLocked = true;
    this.element.hidden = false;
    document.body.classList.add('touch-walking');
    this.syncFullscreen();
    this.showHint();
    this.dispatchEvent({ type: 'lock' });
  }

  unlock() {
    if (!this.isLocked) return;
    this.releaseGestures();
    this.hideHint();
    this.setAction(null);
    this.isLocked = false;
    this.element.hidden = true;
    document.body.classList.remove('touch-walking');
    this.dispatchEvent({ type: 'unlock' });
  }

  /** Shows the action button with `label` (e.g. "안방 문 열기"), or hides it for null. */
  setAction(label) {
    const text = this.isLocked && label ? label : '';
    if (text === this.actionText) return;
    this.actionText = text;
    this.actionButton.textContent = text;
    this.actionButton.hidden = !text;
  }

  dispose() {
    this.unlock();
    this.listeners.abort();
    this.element.remove();
  }

  build() {
    const root = document.createElement('div');
    root.id = 'touch-walk';
    root.className = 'touch-walk';
    root.hidden = true;
    root.innerHTML = `
      <div class="touch-top">
        <button type="button" class="touch-fullscreen" aria-label="전체 화면" aria-pressed="false" hidden>${FULLSCREEN_ICON}</button>
        <button type="button" class="touch-exit">둘러보기 종료</button>
      </div>
      <p class="touch-hint" role="status" hidden>왼쪽 아래 방향키로 걷고, 화면을 밀어 둘러보세요.<br>문 앞에서는 오른쪽 아래 버튼으로 여닫아요.</p>
      <div class="touch-stick-zone">
        <div class="touch-stick" role="img" aria-label="이동 방향키">
          <span class="touch-arrow" data-arrow="up"></span><span class="touch-arrow" data-arrow="right"></span>
          <span class="touch-arrow" data-arrow="down"></span><span class="touch-arrow" data-arrow="left"></span>
          <span class="touch-knob"></span>
        </div>
      </div>
      <button type="button" class="touch-action" hidden></button>`;
    this.stickZone = root.querySelector('.touch-stick-zone');
    this.stickBase = root.querySelector('.touch-stick');
    this.knob = root.querySelector('.touch-knob');
    this.hint = root.querySelector('.touch-hint');
    this.actionButton = root.querySelector('.touch-action');
    this.fullscreenButton = root.querySelector('.touch-fullscreen');
    root.querySelector('.touch-exit').addEventListener('click', () => this.unlock());
    this.actionButton.addEventListener('click', () => this.onAction());
    this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
    return root;
  }

  listen(signal) {
    const root = this.element;
    root.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    root.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    root.addEventListener('pointerup', (event) => this.pointerEnd(event, true), { signal });
    root.addEventListener('pointercancel', (event) => this.pointerEnd(event, false), { signal });
    // Moving a touch's implicit capture from the touched child to this layer can fire a bubbling
    // lostpointercapture on the child; only a capture lost by the layer itself ends the gesture.
    root.addEventListener('lostpointercapture', (event) => { if (event.target === root) this.pointerEnd(event, false); }, { signal });
    // touch-action: none already stops panning and zooming; these cover older iOS paths.
    root.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false, signal });
    root.addEventListener('gesturestart', (event) => event.preventDefault(), { signal });
    root.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    // A tap on "start" walks with touch; a mouse click on the same button locks the pointer.
    document.addEventListener('pointerdown', (event) => { this.lastPointerType = event.pointerType; }, { capture: true, passive: true, signal });
    document.addEventListener('keydown', (event) => { if (this.isLocked && event.key === 'Escape') this.unlock(); }, { signal });
    // Losing focus or hiding the page must never leave the stick held down.
    window.addEventListener('blur', () => this.releaseGestures(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseGestures(); }, { signal });
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, () => this.syncFullscreen(), { signal });
  }

  pointerDown(event) {
    if (!this.isLocked || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest('button')) return; // buttons handle their own clicks
    this.hideHint();
    if (!this.stick && event.target.closest('.touch-stick-zone')) this.startStick(event);
    else if (!this.look) this.startLook(event);
    else return; // a third finger is ignored
    event.preventDefault();
    try { this.element.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
  }

  pointerMove(event) {
    if (this.stick?.id === event.pointerId) { this.moveStick(event.clientX, event.clientY); return; }
    const look = this.look;
    if (look?.id !== event.pointerId) return;
    const dx = event.clientX - look.x, dy = event.clientY - look.y;
    look.x = event.clientX; look.y = event.clientY;
    look.travel = Math.max(look.travel, Math.hypot(event.clientX - look.startX, event.clientY - look.startY));
    if (!dx && !dy) return;
    euler.setFromQuaternion(this.camera.quaternion);
    const next = applyLook({ yaw: euler.y, pitch: euler.x }, dx, dy, look.speed, this.minPolarAngle, this.maxPolarAngle);
    euler.y = next.yaw; euler.x = next.pitch;
    this.camera.quaternion.setFromEuler(euler);
    this.dispatchEvent({ type: 'change' });
  }

  pointerEnd(event, released) {
    if (this.stick?.id === event.pointerId) { this.endStick(); return; }
    const look = this.look;
    if (look?.id !== event.pointerId) return;
    this.look = null;
    const travel = Math.max(look.travel, Math.hypot(event.clientX - look.startX, event.clientY - look.startY));
    if (released && isTap(travel, event.timeStamp - look.time)) this.onTap(this.deviceCoordinates(event.clientX, event.clientY));
  }

  startStick(event) {
    const base = this.stickBase;
    base.classList.add('active'); // no easing while the thumb drives the pad
    base.style.transform = '';
    const rest = base.getBoundingClientRect();
    const half = rest.width / 2;
    let x = rest.left + half, y = rest.top + half;
    // A thumb on the pad acts like a pressed arrow. A thumb elsewhere in the zone moves
    // the pad under the thumb (kept on screen), so walking starts from rest instead of
    // a sudden push. The zone is narrower than two pads on phones, hence the screen bounds.
    if (Math.hypot(event.clientX - x, event.clientY - y) > half) {
      const screen = this.element.getBoundingClientRect();
      const nx = clamp(event.clientX, screen.left + half, Math.max(screen.left + half, screen.right - half));
      const ny = clamp(event.clientY, screen.top + half, Math.max(screen.top + half, screen.bottom - half));
      base.style.transform = `translate(${nx - x}px, ${ny - y}px)`;
      x = nx; y = ny;
    }
    this.stick = { id: event.pointerId, x, y, radius: rest.width * STICK_TRAVEL };
    this.moveStick(event.clientX, event.clientY);
  }

  moveStick(clientX, clientY) {
    const { x, y, radius } = this.stick;
    const dx = clientX - x, dy = clientY - y;
    const knob = clampOffset(dx, dy, radius);
    this.knob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
    const input = stickInput(dx, dy, radius);
    this.forward = input.forward;
    this.right = input.right;
    this.stickBase.dataset.direction = stickDirection(input) ?? '';
  }

  endStick() {
    this.stick = null;
    this.forward = 0;
    this.right = 0;
    this.stickBase.classList.remove('active'); // eases the pad and knob back to rest
    this.stickBase.style.transform = '';
    this.knob.style.transform = '';
    this.stickBase.dataset.direction = '';
  }

  startLook(event) {
    const rect = (this.surface ?? this.element).getBoundingClientRect();
    this.look = {
      id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      time: event.timeStamp, travel: 0, speed: lookSensitivity(rect.width, rect.height),
    };
  }

  releaseGestures() {
    const ids = [this.stick?.id, this.look?.id].filter((id) => id !== undefined);
    this.look = null;
    if (this.stick) this.endStick();
    for (const id of ids) if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
  }

  /** Viewport position → normalized device coordinates of the rendered view. */
  deviceCoordinates(clientX, clientY) {
    const rect = (this.surface ?? this.element).getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * 2 - 1, y: -(clientY - rect.top) / rect.height * 2 + 1 };
  }

  showHint() {
    if (this.hintShown) return;
    this.hintShown = true;
    this.hint.hidden = false;
    this.hintTimer = setTimeout(() => this.hideHint(), HINT_MS);
  }

  hideHint() {
    clearTimeout(this.hintTimer);
    this.hint.hidden = true;
  }

  syncFullscreen() {
    this.fullscreenButton.hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    const on = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
    this.fullscreenButton.setAttribute('aria-pressed', String(on));
    this.fullscreenButton.setAttribute('aria-label', on ? '전체 화면 종료' : '전체 화면');
  }

  toggleFullscreen() {
    const root = document.documentElement;
    const on = Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
    const request = on
      ? (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)
      : (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
    Promise.resolve(request).catch(() => {}); // a refused request leaves the walk as it was
  }
}
