#!/usr/bin/env python3
"""Tighten Whisper's word starts against the voice itself (What's new walkthrough).

  ~/Movies/InkBoard-video/tts/venv/bin/python -I scripts/wn-refine.py tmp/voice-wn src/whatsnew/data/voice-timing.json

Whisper (base.en) places word starts up to ~0.2 s early. For each word after the first, if the
voice has a quiet dip (>= 25 ms below -36 dBFS RMS) whose end falls between 0.03 s before and
0.26 s after Whisper's start (and before the next word's start), the word starts where the voice comes back. Ends follow the next
start. Rewrites the timing file in place.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

voice_dir, path = sys.argv[1], sys.argv[2]
timing = json.load(open(path, encoding="utf-8"))
moved = 0
for line in timing["lines"]:
    x, rate = sf.read(os.path.join(voice_dir, line["file"]), dtype="float32")
    if x.ndim > 1:
        x = x.mean(axis=1)
    win = int(0.01 * rate)
    frames = len(x) // win
    rms = np.sqrt(np.mean(x[: frames * win].reshape(frames, win) ** 2, axis=1) + 1e-12)
    quiet = 20 * np.log10(rms) < -36
    # Ends of quiet runs of 25 ms or more, in seconds.
    ends, run = [], 0
    for i, q in enumerate(quiet):
        if q:
            run += 1
        else:
            if run >= 3:
                ends.append(i * win / rate)
            run = 0
    words = line["words"]
    for k in range(1, len(words)):
        s = words[k]["start"]
        nxt = words[k + 1]["start"] - 0.06 if k + 1 < len(words) else line["duration"]
        near = [e for e in ends if s - 0.03 <= e <= s + 0.26 and words[k - 1]["start"] + 0.05 < e < nxt]
        if near:
            new = min(near, key=lambda e: abs(e - (s + 0.1)))
            if abs(new - s) > 0.02:
                words[k]["start"] = round(new, 3)
                moved += 1
    for k in range(len(words) - 1):
        words[k]["end"] = round(min(max(words[k]["end"], words[k]["start"] + 0.05), words[k + 1]["start"]), 3)
    words[-1]["end"] = round(max(words[-1]["end"], min(line["duration"], words[-1]["start"] + 0.3)), 3)
json.dump(timing, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"moved {moved} word starts")
