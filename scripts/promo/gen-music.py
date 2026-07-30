#!/usr/bin/env python3
"""
Synthesises the demo video's backing track.

Every sample is computed here from oscillators and envelopes, so the track is
original work with no third party in it — nothing to license, nothing to
attribute, nothing that can be claimed later. That is the whole reason this
exists rather than a downloaded file: a free extension should not carry a music
licence, and "probably fine" is not a licence.

Written for the 27s cut. The chord changes are placed against the video's own
beats rather than on a neutral grid, and the plucks land on the four moments
the cursor clicks, so the track moves when the interface does.

Usage: gen-music.py <output.wav> [duration_seconds]
"""
import math
import struct
import sys
import wave

import numpy as np

SR = 44100
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 27.0

# Cmaj7 / Am7 / Fmaj7 / G6 — calm, unhurried, resolves home under the end card.
CHORDS = [
    (0.0,  6.0,  [130.81, 164.81, 196.00, 246.94]),  # Cmaj7
    (5.4,  11.4, [110.00, 130.81, 164.81, 196.00]),  # Am7
    (10.8, 16.8, [87.31, 110.00, 130.81, 164.81]),   # Fmaj7
    (16.2, 21.6, [98.00, 123.47, 146.83, 164.81]),   # G6
    (21.0, 25.4, [110.00, 130.81, 164.81, 196.00]),  # Am7
    (24.2, 27.0, [130.81, 164.81, 196.00, 246.94]),  # Cmaj7, resolving
]

# The moments the synthetic cursor clicks a control in the video.
CLICKS = [6.3, 9.4, 14.4, 18.2]

ARP_START, ARP_END = 3.4, 24.2
ARP_STEP = 0.6


def t_axis(n):
    return np.arange(n, dtype=np.float64) / SR


def fade_window(n, t0, t1, rise, fall):
    """Cosine fade in and out over [t0, t1], in sample space."""
    t = t_axis(n)
    w = np.zeros(n)
    inside = (t >= t0) & (t <= t1)
    w[inside] = 1.0
    up = (t >= t0) & (t < t0 + rise)
    w[up] = 0.5 - 0.5 * np.cos(np.pi * (t[up] - t0) / rise)
    down = (t > t1 - fall) & (t <= t1)
    w[down] = 0.5 + 0.5 * np.cos(np.pi * (t[down] - (t1 - fall)) / fall)
    return w


def pad_voice(n, freq, t0, t1, gain):
    """Two slightly detuned oscillators plus a soft third harmonic. The detune
    is what keeps it from sounding like a test tone."""
    t = t_axis(n)
    sig = (
        np.sin(2 * np.pi * freq * t)
        + 0.7 * np.sin(2 * np.pi * freq * 1.003 * t)
        + 0.18 * np.sin(2 * np.pi * freq * 2 * t)
        + 0.06 * np.sin(2 * np.pi * freq * 3 * t)
    )
    # slow amplitude drift, so a six-second chord is not static
    drift = 1.0 + 0.06 * np.sin(2 * np.pi * 0.13 * t + freq)
    return sig * drift * fade_window(n, t0, t1, 1.6, 1.6) * gain


def pluck(n, freq, at, gain, decay=0.75):
    t = t_axis(n)
    rel = t - at
    env = np.where(rel >= 0, np.exp(-rel / decay), 0.0)
    env *= np.where(rel >= 0, np.minimum(rel / 0.006, 1.0), 0.0)  # tiny attack
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    return sig * env * gain


def chord_at(time):
    best = CHORDS[0][2]
    for t0, _t1, notes in CHORDS:
        if time >= t0:
            best = notes
    return best


def main(out_path):
    n = int(DURATION * SR)
    left = np.zeros(n)
    right = np.zeros(n)

    # --- pads
    for t0, t1, notes in CHORDS:
        for i, f in enumerate(notes):
            v = pad_voice(n, f, t0, min(t1, DURATION), 0.115)
            # spread the chord across the stereo field
            p = 0.5 + (i - 1.5) * 0.11
            left += v * (1 - p)
            right += v * p

    # --- sub bass on the root
    for t0, t1, notes in CHORDS:
        v = pad_voice(n, notes[0] / 2, t0, min(t1, DURATION), 0.085)
        left += v * 0.5
        right += v * 0.5

    # --- arpeggio, entering with the popup and leaving before the end card.
    # Two octaves stacked: the lower one carries the note, the quiet upper one
    # is there so the track does not sound muffled on laptop speakers, where
    # most of this will be heard.
    step = 0
    time = ARP_START
    while time < ARP_END:
        notes = chord_at(time)
        base = notes[step % len(notes)]
        v = pluck(n, base * 4, time, 0.05) + pluck(n, base * 8, time, 0.018, decay=0.45)
        p = 0.5 + 0.22 * math.sin(step * 0.9)
        left += v * (1 - p)
        right += v * p
        time += ARP_STEP
        step += 1

    # --- one bright note on each click, so the track moves with the interface
    for c in CLICKS:
        notes = chord_at(c)
        v = pluck(n, notes[-1] * 4, c, 0.075, decay=0.45)
        left += v * 0.5
        right += v * 0.5

    # --- master shaping
    master = fade_window(n, 0.0, DURATION, 1.8, 2.2)
    left *= master
    right *= master

    peak = max(np.abs(left).max(), np.abs(right).max())
    if peak > 0:
        # -9 dBFS. There is no voiceover to duck under, but a store demo that
        # blares is a demo people mute — which would be a poor joke here.
        target = 10 ** (-9 / 20)
        left *= target / peak
        right *= target / peak

    stereo = np.empty(n * 2, dtype=np.float64)
    stereo[0::2] = left
    stereo[1::2] = right
    pcm = np.clip(stereo * 32767, -32768, 32767).astype('<i2')

    with wave.open(out_path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())

    print(f'wrote {out_path}: {DURATION:.1f}s, peak -9 dBFS')


if __name__ == '__main__':
    main(sys.argv[1])
