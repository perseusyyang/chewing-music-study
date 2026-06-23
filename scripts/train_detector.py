#!/usr/bin/env python3
"""
Train a chewing detector from labeled data.

Usage:
  1. Record sessions with /record.html  →  get .json files
  2. Label them with /label.html        →  get labeled .json files
  3. python scripts/train_detector.py data/*.json
  4. Model saved to frontend/js/detector_model.js

Architecture:
  Sliding window → feature extraction → MLP classifier → chew/bite/none
  Exported as pure JS for browser inference.
"""

import json
import sys
import os
import numpy as np
from collections import Counter

# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

WINDOW_MS = 400       # look-back window for each prediction
STRIDE_MS = 50        # step between training samples
LABEL_WINDOW_MS = 150  # if a labeled event is within this range, assign that label

def extract_features(frames, t_center_ms):
    """Extract a feature vector from a window ending at t_center_ms."""
    window_start = t_center_ms - WINDOW_MS
    window = [f for f in frames if f['t_ms'] >= window_start and f['t_ms'] <= t_center_ms]

    if len(window) < 5:
        return None

    mo = np.array([f['mouth_open'] for f in window])
    jd = np.array([f['jaw_drop'] for f in window])

    # Compute derivatives (frame-to-frame changes)
    d_mo = np.diff(mo) if len(mo) > 1 else np.array([0])
    d_jd = np.diff(jd) if len(jd) > 1 else np.array([0])

    return np.array([
        np.mean(mo), np.std(mo), np.max(mo), np.min(mo),
        np.mean(jd), np.std(jd), np.max(jd), np.min(jd),
        np.mean(np.abs(d_mo)), np.max(np.abs(d_mo)),
        np.mean(np.abs(d_jd)), np.max(np.abs(d_jd)),
        mo[-1], jd[-1],           # current value
        mo[-1] - mo[0], jd[-1] - jd[0],  # trend
        np.percentile(mo, 90), np.percentile(jd, 90),
        len(window),              # frame count in window
    ])

def make_training_data(labeled_sessions):
    """Convert labeled sessions into (X, y) for training."""
    X, y = [], []
    label_names = ['none', 'chew', 'bite']

    for session in labeled_sessions:
        frames = session['frames']
        labels = session.get('labels', {})
        chews = set(labels.get('chews_ms', []))
        bites = set(labels.get('bites_ms', []))

        duration = frames[-1]['t_ms']
        for t in np.arange(WINDOW_MS, duration, STRIDE_MS):
            feat = extract_features(frames, t)
            if feat is None:
                continue

            # Determine label: check if any labeled event is within LABEL_WINDOW_MS
            lbl = 0  # none
            for ct in chews:
                if abs(t - ct) < LABEL_WINDOW_MS:
                    lbl = 1  # chew
                    break
            for bt in bites:
                if abs(t - bt) < LABEL_WINDOW_MS:
                    lbl = 2  # bite
                    break

            X.append(feat)
            y.append(lbl)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    return X, y, label_names

# ---------------------------------------------------------------------------
# Model training
# ---------------------------------------------------------------------------

def split_by_session(sessions, train_ratio=0.6, val_ratio=0.2, test_ratio=0.2, seed=42):
    """
    Split SESSIONS (not frames) into train/val/test.
    Sessions from the same person/recording stay together to avoid data leakage.
    """
    rng = np.random.RandomState(seed)
    idx = rng.permutation(len(sessions))
    n = len(sessions)
    n_train = max(1, int(n * train_ratio))
    n_val = max(1, int(n * val_ratio))
    n_test = n - n_train - n_val

    train_idx = idx[:n_train]
    val_idx = idx[n_train:n_train + n_val]
    test_idx = idx[n_train + n_val:]

    print(f"Split: {len(train_idx)} train / {len(val_idx)} val / {len(test_idx)} test sessions")
    return train_idx, val_idx, test_idx


def sessions_to_xy(session_indices, sessions):
    """Convert a subset of sessions to (X, y)."""
    return make_training_data([sessions[i] for i in session_indices])


def train_model(sessions, label_names):
    """Train with proper session-level train/val/test split."""
    from sklearn.preprocessing import StandardScaler
    from sklearn.neural_network import MLPClassifier
    from sklearn.metrics import classification_report, confusion_matrix

    # Split at session level
    train_idx, val_idx, test_idx = split_by_session(sessions)

    # Build feature matrices
    X_train, y_train, _ = sessions_to_xy(train_idx, sessions)
    X_val, y_val, _ = sessions_to_xy(val_idx, sessions)
    X_test, y_test, _ = sessions_to_xy(test_idx, sessions)

    if len(X_train) == 0:
        print("ERROR: Not enough training data. Record more sessions.")
        return None, None

    # Normalize (fit on TRAIN only, apply to all)
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_val_s = scaler.transform(X_val) if len(X_val) else None
    X_test_s = scaler.transform(X_test) if len(X_test) else None

    # Class distribution
    counts = Counter(y_train)
    print(f"Class distribution (train): { {label_names[i]: counts.get(i, 0) for i in range(3)} }")

    # MLP with validation-based early stopping
    model = MLPClassifier(
        hidden_layer_sizes=(16, 8),
        activation='relu',
        max_iter=500,
        early_stopping=True,
        validation_fraction=0.1,  # internal val for early stopping
        random_state=42,
    )
    model.fit(X_train_s, y_train)

    # --- Evaluation ---
    print(f"\n{'='*60}")
    print(f"Train accuracy: {model.score(X_train_s, y_train):.3f}")

    if X_val_s is not None and len(X_val_s):
        val_acc = model.score(X_val_s, y_val)
        y_val_pred = model.predict(X_val_s)
        print(f"\n--- Validation Set ({len(y_val)} samples) ---")
        print(f"Accuracy: {val_acc:.3f}")
        print(classification_report(y_val, y_val_pred, target_names=label_names, zero_division=0))

    if X_test_s is not None and len(X_test_s):
        test_acc = model.score(X_test_s, y_test)
        y_test_pred = model.predict(X_test_s)
        print(f"\n--- Test Set ({len(y_test)} samples) ---")
        print(f"Accuracy: {test_acc:.3f}")
        print(classification_report(y_test, y_test_pred, target_names=label_names, zero_division=0))
        print("Confusion matrix:")
        print(confusion_matrix(y_test, y_test_pred))

    print(f"{'='*60}\n")

    return model, scaler

# ---------------------------------------------------------------------------
# Export to JS
# ---------------------------------------------------------------------------

def export_js(model, scaler, label_names, output_path):
    """Export model as a standalone JS module."""
    coefs = [c.tolist() for c in model.coefs_]
    intercepts = [i.tolist() for i in model.intercepts_]
    activation = model.activation

    js = f"""/**
 * Auto-generated chewing detector model.
 * Do not edit — regenerate with scripts/train_detector.py
 *
 * Input: {model.n_features_in_} features (see extractFeatures below)
 * Output: probability of [none, chew, bite]
 */

const MODEL = {{
  coefs: {json.dumps(coefs)},
  intercepts: {json.dumps(intercepts)},
  activation: '{activation}',
}};

const SCALER = {{
  mean: {json.dumps(scaler.mean_.tolist())},
  scale: {json.dumps(scaler.scale_.tolist())},
}};

const LABELS = {json.dumps(label_names)};

const WINDOW_MS = {WINDOW_MS};
const LABEL_WINDOW_MS = {LABEL_WINDOW_MS};

/**
 * Extract features from a history buffer of {{t_ms, mouth_open, jaw_drop}}.
 * Called each frame to get input for the model.
 */
function extractFeatures(history, tCenterMs) {{
  const windowStart = tCenterMs - WINDOW_MS;
  const window = history.filter(f => f.t_ms >= windowStart && f.t_ms <= tCenterMs);

  if (window.length < 5) return null;

  const mo = window.map(f => f.mouth_open);
  const jd = window.map(f => f.jaw_drop);

  const mean = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
  const std = arr => {{ const m = mean(arr); return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length); }};
  const max = arr => Math.max(...arr);
  const min = arr => Math.min(...arr);
  const diff = arr => arr.slice(1).map((v, i) => v - arr[i]);

  const d_mo = diff(mo);
  const d_jd = diff(jd);
  const absMean = arr => arr.reduce((a,b) => a + Math.abs(b), 0) / arr.length;
  const absMax = arr => Math.max(...arr.map(Math.abs));
  const percentile = (arr, p) => {{ const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length * p/100)]; }};

  return [
    mean(mo), std(mo), max(mo), min(mo),
    mean(jd), std(jd), max(jd), min(jd),
    d_mo.length ? absMean(d_mo) : 0, d_mo.length ? absMax(d_mo) : 0,
    d_jd.length ? absMean(d_jd) : 0, d_jd.length ? absMax(d_jd) : 0,
    mo[mo.length-1], jd[jd.length-1],
    mo[mo.length-1] - mo[0], jd[jd.length-1] - jd[0],
    percentile(mo, 90), percentile(jd, 90),
    window.length,
  ];
}}

/**
 * Run inference on a feature vector.
 * Returns {{none, chew, bite}} probabilities (sum to 1).
 */
function predict(features) {{
  // Normalize
  const scaled = features.map((v, i) => (v - SCALER.mean[i]) / SCALER.scale[i]);

  // Forward pass through MLP layers
  let x = scaled;
  for (let layer = 0; layer < MODEL.coefs.length; layer++) {{
    const W = MODEL.coefs[layer];
    const b = MODEL.intercepts[layer];
    const next = new Array(W[0].length).fill(0);
    for (let i = 0; i < x.length; i++) {{
      for (let j = 0; j < W[0].length; j++) {{
        next[j] += x[i] * W[i][j];
      }}
    }}
    for (let j = 0; j < next.length; j++) {{
      next[j] += b[j];
      // ReLU
      if (MODEL.activation === 'relu' && layer < MODEL.coefs.length - 1) {{
        next[j] = Math.max(0, next[j]);
      }}
    }}
    x = next;
  }}

  // Softmax
  const maxLogit = Math.max(...x);
  const exp = x.map(v => Math.exp(v - maxLogit));
  const sum = exp.reduce((a, b) => a + b, 0);
  return {{
    none: exp[0] / sum,
    chew: exp[1] / sum,
    bite: exp[2] / sum,
  }};
}}

export {{ MODEL, SCALER, LABELS, WINDOW_MS, LABEL_WINDOW_MS, extractFeatures, predict }};
"""

    with open(output_path, 'w') as f:
        f.write(js)
    print(f"Model exported to {output_path} ({len(js)} bytes)")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    sessions = []
    for pattern in sys.argv[1:]:
        # Handle glob
        import glob as g
        for path in sorted(g.glob(pattern)):
            with open(path) as f:
                data = json.load(f)
            if not data.get('labels') or (not data['labels'].get('chews_ms') and not data['labels'].get('bites_ms')):
                print(f"  SKIP {path} — no labels")
                continue
            sessions.append(data)
            print(f"  LOAD {path}: {data.get('frame_count', 0)} frames, "
                  f"{len(data['labels'].get('chews_ms', []))} chews, "
                  f"{len(data['labels'].get('bites_ms', []))} bites")

    if not sessions:
        print("ERROR: No labeled sessions found. Record & label some data first.")
        sys.exit(1)

    print(f"\nTotal: {len(sessions)} labeled sessions")

    label_names = ['none', 'chew', 'bite']
    model, scaler = train_model(sessions, label_names)

    if model is None:
        sys.exit(1)

    output = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'detector_model.js')
    export_js(model, scaler, label_names, os.path.abspath(output))

if __name__ == '__main__':
    main()
