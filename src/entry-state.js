// The HTML owns first paint; reveal only the completed initial view.
export function completeEntry() {
  document.documentElement.dataset.entryState = 'ready';
  document.getElementById('entry-shell')?.remove();
}
export function failEntry() {
  document.documentElement.dataset.entryState = 'error';
  const message = document.getElementById('entry-message');
  if (message) message.textContent = '화면을 불러오지 못했어요. 연결을 확인하고 다시 열어 주세요.';
  document.getElementById('entry-retry')?.removeAttribute('hidden');
}
