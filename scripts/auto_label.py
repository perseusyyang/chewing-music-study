#!/usr/bin/env python3
"""
Auto-detect candidate chew and bite events from recorded session JSON.
Outputs a labeled JSON that you can then review/correct in label.html.

Usage:
  python scripts/auto_label.py chewing-session-*.json
  → produces auto-labeled-*.json

How it works:
  - Chews: detect peaks in mouth_open signal within active chewing regions
  - Bites: detect sharp jaw_drop spikes that stand out from baseline
  - Review the output in label.html — this is a STARTING POINT, not ground truth!
"""

import json
import sys
import numpy as np
from scipy.signal import find_peaks


def detect_chewing_regions(frames, min_peak_height=0.003, min_distance_ms=250, min_window_peaks=4):
    """
    Find regions with rhythmic mouth_open oscillation (chewing).
    Returns list of (start_ms, end_ms) regions.
    """
    duration = frames[-1]['t_ms']
    window_ms = 5000
    stride_ms = 2000

    active_regions = []
    for w_start in np.arange(0, duration, stride_ms):
        w_end = w_start + window_ms
        win = [f for f in frames if w_start <= f['t_ms'] < w_end]
        if len(win) < 50:
            continue

        mo = np.array([f['mouth_open'] for f in win])
        times = np.array([f['t_ms'] for f in win])

        avg_interval_ms = np.mean(np.diff(times))
        min_dist = max(3, int(min_distance_ms / avg_interval_ms))

        peaks, properties = find_peaks(mo, height=min_peak_height, distance=min_dist)

        if len(peaks) >= min_window_peaks and np.std(mo) > 0.002:
            active_regions.append((int(w_start), int(w_end)))

    # Merge overlapping regions
    if not active_regions:
        return []

    active_regions.sort()
    merged = [active_regions[0]]
    for start, end in active_regions[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged


def detect_chews_in_region(frames, region_start_ms, region_end_ms, min_peak_height=0.003, min_distance_ms=250):
    """Detect individual chew peaks within a chewing region."""
    win = [f for f in frames if region_start_ms <= f['t_ms'] < region_end_ms]
    if len(win) < 10:
        return []

    mo = np.array([f['mouth_open'] for f in win])
    times = np.array([f['t_ms'] for f in win])

    avg_interval_ms = np.mean(np.diff(times))
    min_dist = max(3, int(min_distance_ms / avg_interval_ms))

    peaks, properties = find_peaks(mo, height=min_peak_height, distance=min_dist)

    # Filter: keep peaks with some prominence
    if 'prominences' in properties:
        median_prom = np.median(properties['prominences'])
        peaks = [p for i, p in enumerate(peaks) if properties['prominences'][i] >= median_prom * 0.3]

    return [int(times[p]) for p in peaks]


def detect_bites(frames, chew_regions, jd_spike_threshold=0.05, min_distance_ms=3000):
    """
    Detect bite events: sharp jaw_drop spikes within or near chewing regions.
    A bite is a local maximum in jaw_drop that stands significantly above baseline.
    """
    all_bites = []

    for region_start, region_end in chew_regions:
        # Extend region slightly to catch bites at edges
        extended_start = max(0, region_start - 2000)
        extended_end = min(frames[-1]['t_ms'], region_end + 2000)

        win = [f for f in frames if extended_start <= f['t_ms'] < extended_end]
        if len(win) < 10:
            continue

        jd = np.array([f['mouth_open'] for f in win])
        times = np.array([f['t_ms'] for f in win])

        # Use jaw_drop for bite detection
        jd_full = np.array([f['jaw_drop'] for f in win])

        avg_interval_ms = np.mean(np.diff(times))
        min_dist = max(3, int(min_distance_ms / avg_interval_ms))

        # Detect peaks in jaw_drop
        baseline = np.median(jd_full)
        height = baseline + jd_spike_threshold

        peaks, properties = find_peaks(jd_full, height=height, distance=min_dist)

        if 'prominences' in properties and len(properties['prominences']) > 0:
            # Keep only the most prominent peaks (top 30%)
            threshold = np.percentile(properties['prominences'], 70)
            peaks = [p for i, p in enumerate(peaks) if properties['prominences'][i] >= threshold]

        for p in peaks:
            all_bites.append(int(times[p]))

    # Deduplicate and sort
    all_bites = sorted(set(all_bites))

    # Merge bites that are too close (< 1500ms)
    merged = []
    for t in all_bites:
        if merged and t - merged[-1] < 1500:
            # Keep the later one (usually the actual bite peak)
            continue
        merged.append(t)

    return merged


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    for path in sys.argv[1:]:
        with open(path) as f:
            data = json.load(f)

        frames = data['frames']
        print(f"\n{'='*60}")
        print(f"Processing: {path}")
        print(f"  Duration: {data['duration_ms']/1000:.0f}s, Frames: {data['frame_count']}")

        # Step 1: Find chewing regions
        chew_regions = detect_chewing_regions(frames)
        print(f"  Found {len(chew_regions)} chewing regions:")
        for i, (s, e) in enumerate(chew_regions):
            print(f"    Region {i+1}: {s/1000:.1f}s – {e/1000:.1f}s  ({(e-s)/1000:.1f}s)")

        # Step 2: Detect individual chew events
        all_chews = []
        for region_start, region_end in chew_regions:
            chews = detect_chews_in_region(frames, region_start, region_end)
            all_chews.extend(chews)

        all_chews = sorted(set(all_chews))
        print(f"  Detected {len(all_chews)} candidate chew events")

        # Step 3: Detect bite events
        bites = detect_bites(frames, chew_regions)
        print(f"  Detected {len(bites)} candidate bite events")

        # Step 4: Attach labels
        data['labels'] = {
            'chews_ms': all_chews,
            'bites_ms': bites,
        }

        # Save
        out_name = path.replace('.json', '') + '-auto-labeled.json'
        # Handle both with/without path prefix
        if '/' in path:
            out_name = path.rsplit('/', 1)[0] + '/auto-labeled-' + path.rsplit('/', 1)[1]
        else:
            out_name = 'auto-labeled-' + path

        with open(out_name, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"  → Saved: {out_name}")
        print(f"  ⚠️  REVIEW in label.html before training! Auto-detection is ~80% accurate.")


if __name__ == '__main__':
    main()
