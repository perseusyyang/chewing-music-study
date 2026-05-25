import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('has dom', () => {
    document.body.innerHTML = '<div id="x">hi</div>';
    expect(document.getElementById('x').textContent).toBe('hi');
  });
});
