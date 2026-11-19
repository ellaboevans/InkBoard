#!/usr/bin/env python3
"""Voiceover for the launch reel: Kokoro (af_heart), one clip per line, word timings.

Run with the Kokoro venv's Python (it has kokoro-onnx, numpy and soundfile):

  ~/Movies/InkBoard-video/tts/venv/bin/python -I reels-studio/scripts/voice.py \
      reels-studio/src/data/script.json reels-studio/tmp/voice

Reads the script (lines of [shown, spoken] word pairs), writes one WAV per line and
`timing.json`: per line its duration and, per shown word, its start and end in seconds,
measured from the line's own audio. Word times come from the length of each spoken
prefix (Kokoro reads "Poetry deserves" in about the time "Poetry deserves better"
takes to reach "better"), snapped to the nearest dip in loudness of the full line.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

TTS = os.path.expanduser("~/Movies/InkBoard-video/tts/models")
RATE = 24000


def voiced_end(x, thr=0.012):
    """Seconds up to the last sample above the threshold (Kokoro pads a little silence)."""
    idx = np.where(np.abs(x) > thr)[0]
    return (idx[-1] + 1) / RATE if len(idx) else 0.0


def voiced_start(x, thr=0.012):
    idx = np.where(np.abs(x) > thr)[0]
    return idx[0] / RATE if len(idx) else 0.0


def rms_curve(x, win=0.02):
    n = int(win * RATE)
    pad = np.pad(x.astype(np.float64) ** 2, (n // 2, n // 2))
    c = np.convolve(pad, np.ones(n) / n, mode="valid")
    return np.sqrt(c[: len(x)])


def snap(curve, t, reach=0.09):
    a, b = int(max(0, (t - reach) * RATE)), int(min(len(curve) - 1, (t + reach) * RATE))
    if b <= a:
        return t
    return (a + int(np.argmin(curve[a:b]))) / RATE


def main():
    script_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    script = json.load(open(script_path, encoding="utf-8"))
    k = Kokoro(os.path.join(TTS, "kokoro-v1.0.onnx"), os.path.join(TTS, "voices-v1.0.bin"))
    voice, speed = script["voice"], script["speed"]

    def say(text, sp=speed):
        samples, rate = k.create(text, voice=voice, speed=sp, lang="en-us")
        assert rate == RATE
        return np.asarray(samples, dtype=np.float32)

    out = []
    for i, line in enumerate(script["lines"]):
        words = line["words"]  # [[shown, spoken], ...]
        spoken = [w[1] for w in words]
        sp = line.get("speed", speed)
        full = say(" ".join(spoken), sp)
        # Trim leading/trailing silence to 30 ms either side.
        s0 = max(0, int((voiced_start(full) - 0.03) * RATE))
        s1 = min(len(full), int((voiced_end(full) + 0.06) * RATE))
        full = full[s0:s1]
        dur = len(full) / RATE
        curve = rms_curve(full)
        lead, tail = voiced_start(full), voiced_end(full)
        # 1. Pauses: runs of at least 60 ms below the threshold, inside the voiced span.
        quiet = curve < 0.012
        pauses, j = [], int(lead * RATE)
        while j < int(tail * RATE):
            if quiet[j]:
                k2 = j
                while k2 < len(quiet) and quiet[k2]:
                    k2 += 1
                if (k2 - j) / RATE >= 0.06 and k2 < int(tail * RATE):
                    pauses.append((j / RATE, k2 / RATE))
                j = k2
            else:
                j += 1
        # 2. Phrases end at words with punctuation; their breaks take the longest pauses, in order.
        breaks = [n for n, w in enumerate(spoken[:-1]) if w[-1] in ",.!?:;"]
        chosen = sorted(sorted(pauses, key=lambda p: p[1] - p[0], reverse=True)[: len(breaks)])
        if len(chosen) < len(breaks):
            breaks = breaks[: len(chosen)]
        spans, prev, first = [], lead, 0
        for n, (pa, pb) in zip(breaks, chosen):
            spans.append((first, n, prev, pa))
            prev, first = pb, n + 1
        spans.append((first, len(spoken) - 1, prev, tail))
        # 3. Inside a phrase: split by each word's own spoken length, then snap to a dip.
        weights = [max(0.12, voiced_end(say(w, sp)) - voiced_start(say(w, sp))) for w in spoken]
        starts, ends = [0.0] * len(spoken), [0.0] * len(spoken)
        for (a, b, t0, t1) in spans:
            total = sum(weights[a : b + 1])
            t = t0
            for n in range(a, b + 1):
                starts[n] = t
                t = t + (t1 - t0) * weights[n] / total
                if n < b:
                    t = snap(curve, t, reach=0.05)
                ends[n] = t if n < b else t1
        for n in range(1, len(starts)):
            starts[n] = max(starts[n], starts[n - 1] + 0.06)
        print("   pauses", [(round(a, 2), round(b, 2)) for a, b in pauses])
        path = os.path.join(out_dir, f"line{i:02d}.wav")
        sf.write(path, full, RATE)
        out.append({
            "id": line["id"],
            "file": os.path.basename(path),
            "duration": round(dur, 3),
            "words": [
                {"text": w[0], "start": round(a, 3), "end": round(b, 3), **({"page": True} if len(w) > 2 and w[2] == "page" else {})}
                for w, a, b in zip(words, starts, ends)
            ],
        })
        print(f"{line['id']:>10} {dur:5.2f}s  " + "  ".join(f"{w['text']}@{w['start']:.2f}" for w in out[-1]["words"]), flush=True)
    json.dump({"rate": RATE, "lines": out}, open(os.path.join(out_dir, "timing.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
