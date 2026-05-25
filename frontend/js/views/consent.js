/**
 * Wires the consent view: enable Continue only when checkbox is checked.
 * On Continue, navigate to /setup.
 */
export function mountConsent(router) {
  const checkbox = document.getElementById('consent-check');
  const button = document.getElementById('consent-continue');
  checkbox.addEventListener('change', () => {
    button.disabled = !checkbox.checked;
  });
  button.addEventListener('click', () => router.navigate('/setup'));
}
