import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '../js/router.js';

describe('Router', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('invokes handler for current hash on start', () => {
    const onConsent = vi.fn();
    const r = new Router({ '/consent': onConsent });
    window.location.hash = '#/consent';
    r.start();
    expect(onConsent).toHaveBeenCalledTimes(1);
  });

  it('invokes handler on hashchange', () => {
    const onSetup = vi.fn();
    const r = new Router({ '/setup': onSetup });
    r.start();
    window.location.hash = '#/setup';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it('falls back to default route when no match', () => {
    const onDefault = vi.fn();
    const r = new Router({ '/default': onDefault }, '/default');
    r.start();
    expect(onDefault).toHaveBeenCalled();
  });
});
