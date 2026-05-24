import { describe, it, expect } from 'vitest';
import { ChewDetector } from '../js/detector.js';

describe('ChewDetector: sample buffer', () => {
  it('stores samples added to it', () => {
    const d = new ChewDetector({ windowSec: 5 });
    d.addSample(0, 0.10);
    d.addSample(100, 0.12);
    expect(d._samples.length).toBe(2);
  });

  it('prunes samples older than windowSec', () => {
    const d = new ChewDetector({ windowSec: 5 });
    d.addSample(0, 0.10);
    d.addSample(2000, 0.11);
    d.addSample(8000, 0.12); // window cutoff = 8000 - 5000 = 3000, drops t=0 and t=2000
    expect(d._samples.length).toBe(1);
    expect(d._samples[0].t_ms).toBe(8000);
  });
});
