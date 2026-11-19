#!/usr/bin/env python3
"""Word timings for the reel's captions, from the voice itself.

  reels-studio/tmp/whisper-venv/bin/python -I reels-studio/scripts/align.py \
      reels-studio/src/data/script.json reels-studio/tmp/voice reels-studio/src/data/voice-timing.json

Whisper (faster-whisper, base.en, on the CPU) transcribes each line with word
timestamps. Its words rarely split like ours ("Ink Board" / "InkBoard", the URL), so
both sides are reduced to letters, matched with difflib, and each shown word's
start/end is read off the Whisper letter it lines up with (interpolated inside a word).
"""
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np

from faster_whisper import WhisperModel


def letters(s):
    return re.sub(r"[^a-z]", "", s.lower())


def main():
    script_path, voice_dir, out_path = sys.argv[1:4]
    script = json.load(open(script_path, encoding="utf-8"))
    synth = {l["id"]: l for l in json.load(open(os.path.join(voice_dir, "timing.json")))["lines"]}
    model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=2)
    out = []
    for line in script["lines"]:
        spoken = [w[1] for w in line["words"]]
        wav = os.path.join(voice_dir, synth[line["id"]]["file"])
        pcm = subprocess.run(["/opt/homebrew/bin/ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                             capture_output=True, check=True).stdout
        audio = np.frombuffer(pcm, dtype=np.float32)
        segs, _ = model.transcribe(audio, language="en", word_timestamps=True, beam_size=5,
                                   initial_prompt=" ".join(spoken), vad_filter=False)
        ww = [w for s in segs for w in s.words]
        # One time per Whisper letter, spread evenly through its word.
        wl, wt = [], []
        for w in ww:
            L = letters(w.word)
            for k, ch in enumerate(L):
                wl.append(ch)
                wt.append(w.start + (w.end - w.start) * (k + 0.5) / max(1, len(L)))
        whisper_letters = "".join(wl)
        ours = [letters(s) for s in spoken]
        ours_all = "".join(ours)
        sm = difflib.SequenceMatcher(None, ours_all, whisper_letters, autojunk=False)
        mapping = {}
        for a, b, size in sm.get_matching_blocks():
            for k in range(size):
                mapping[a + k] = b + k

        def time_at(idx, first):
            # Nearest mapped letter, searching forward (word start) or backward (word end).
            rng = range(idx, len(ours_all)) if first else range(idx, -1, -1)
            for k in rng:
                if k in mapping:
                    return wt[mapping[k]]
            return None

        words, pos = [], 0
        for (shown, said, *flag), L in zip(line["words"], ours):
            s = time_at(pos, True)
            e = time_at(pos + len(L) - 1, False)
            words.append({"text": shown, "start": s, "end": e, **({"page": True} if flag == ["page"] else {})})
            pos += len(L)
        # Word starts from Whisper's own word starts where a word begins exactly there.
        for w in words:
            near = [x for x in ww if w["start"] is not None and abs(x.start - w["start"]) < 0.12]
            if near:
                w["start"] = min(near, key=lambda x: abs(x.start - w["start"])).start
        # Fill gaps and keep the order.
        dur = synth[line["id"]]["duration"]
        for k, w in enumerate(words):
            if w["start"] is None:
                w["start"] = words[k - 1]["end"] if k else 0.0
            if w["end"] is None or w["end"] < w["start"]:
                w["end"] = words[k + 1]["start"] if k + 1 < len(words) and words[k + 1]["start"] else dur
            w["start"], w["end"] = round(max(0.0, w["start"]), 3), round(min(dur, w["end"]), 3)
        for k in range(1, len(words)):
            words[k]["start"] = max(words[k]["start"], words[k - 1]["start"] + 0.05)
        heard = " ".join(x.word.strip() for x in ww)
        print(f"{line['id']:>8} {dur:4.2f}s heard: {heard!r}")
        print("          " + "  ".join(f"{w['text']}@{w['start']:.2f}-{w['end']:.2f}" for w in words))
        out.append({"id": line["id"], "file": synth[line["id"]]["file"], "duration": dur, "heard": heard, "words": words})
    json.dump({"lines": out}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
