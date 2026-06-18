/**
 * Wires the tempo study consent view.
 * Same pattern as main consent but used by tempo study.
 */
export function mountConsent(router) {
  const checkbox = document.getElementById('consent-check');
  const button = document.getElementById('consent-continue');
  checkbox.addEventListener('change', () => {
    button.disabled = !checkbox.checked;
  });
  button.addEventListener('click', () => router.navigate('/setup'));
}
