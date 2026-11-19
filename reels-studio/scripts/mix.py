#!/usr/bin/env python3
"""The reel's soundtrack: Kokoro voice lines at their times, "Inspired" ducked underneath.

  python3 reels-studio/scripts/mix.py            (from the worktree root or reels-studio/)

- Voice: each tmp/voice/lineNN.wav placed at its time in src/data/placement.json, levelled
  to -16 LUFS like narrate.py.
- Music: Kevin MacLeod's "Inspired" (CC BY 4.0), levelled to -30 LUFS, faded in and out,
  and ducked under the voice with the same sidechain settings as mixmusic.py
  (threshold 0.015, ratio 6, attack 30 ms, release 600 ms). The fade-in is shorter (0.4 s
  instead of 1.5 s) because a Reel's first second has to carry.
- Final mix levelled to -16 LUFS, true peak -1.5 dB: tmp/soundtrack.wav.

With no arguments it builds the Reel's soundtrack, as above. The What's new walkthrough passes its own:
  python3 reels-studio/scripts/mix.py --placement src/whatsnew/data/placement.json \
      --timing src/whatsnew/data/voice-timing.json --voice-dir tmp/voice-wn --out tmp/soundtrack-wn.wav
(a placement file with "lines" and "duration" gives both the start times and the length).
"""
import argparse
import json
import os
import subprocess

FFMPEG = "/opt/homebrew/bin/ffmpeg"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.expanduser("~/Movies/InkBoard-video/music/kevin-macleod/Inspired.mp3")
ap = argparse.ArgumentParser()
ap.add_argument("--placement", default="src/data/placement.json")
ap.add_argument("--timing", default="src/data/voice-timing.json")
ap.add_argument("--voice-dir", default="tmp/voice")
ap.add_argument("--out", default="tmp/soundtrack.wav")
ap.add_argument("--stems", action="store_true",
                help="render the voice and the ducked music as separate files, then mix them: in one graph ffmpeg ends "
                     "the music with the last voice line, and the walkthrough's music has to carry its ending")
a = ap.parse_args()

placement = json.load(open(os.path.join(HERE, a.placement)))
DURATION = 35.0
if isinstance(placement.get("lines"), dict):
    DURATION = float(placement["duration"])
    placement = placement["lines"]
timing = json.load(open(os.path.join(HERE, a.timing)))
lines = [(l["file"], placement[l["id"]]) for l in timing["lines"]]

inputs, chains = [], []
for k, (file, at) in enumerate(lines):
    inputs += ["-i", os.path.join(HERE, a.voice_dir, file)]
    chains.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=mono,adelay={int(round(at * 1000))}:all=1[v{k}]")
n = len(lines)
mix = "".join(f"[v{k}]" for k in range(n))
chains.append(f"{mix}amix=inputs={n}:normalize=0:dropout_transition=0,apad,atrim=0:{DURATION},"
              f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,asplit=2[voice][key]")
inputs += ["-i", MUSIC]
fo = DURATION - 3.0
chains.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{DURATION},asetpts=PTS-STARTPTS,"
              f"loudnorm=I=-30:TP=-6:LRA=11,afade=t=in:st=0:d=0.4,afade=t=out:st={fo}:d=3.0[music]")
chains.append("[music][key]sidechaincompress=threshold=0.015:ratio=6:attack=30:release=600:makeup=1[ducked]")
chains.append("[voice][ducked]amix=inputs=2:normalize=0:duration=first,"
              "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[aout]")
out = os.path.join(HERE, a.out)
if not a.stems:
    subprocess.run([FFMPEG, "-v", "error", "-y"] + inputs + ["-filter_complex", ";".join(chains), "-map", "[aout]",
                    "-t", f"{DURATION}", out], check=True)
else:
    # The same filters, the last stage on its own: voice stem, ducked music stem, then the mix.
    stem = lambda name: out.replace(".wav", f"-{name}.wav")
    graph = ";".join(chains[:-1])
    subprocess.run([FFMPEG, "-v", "error", "-y"] + inputs + ["-filter_complex", graph + ";[ducked]anullsink",
                    "-map", "[voice]", "-t", f"{DURATION}", stem("voice")], check=True)
    subprocess.run([FFMPEG, "-v", "error", "-y"] + inputs + ["-filter_complex", graph + ";[voice]anullsink",
                    "-map", "[ducked]", "-t", f"{DURATION}", stem("music")], check=True)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", stem("voice"), "-i", stem("music"), "-filter_complex",
                    "[0:a][1:a]amix=inputs=2:normalize=0:duration=longest,apad,atrim=0:" + f"{DURATION},"
                    "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[aout]",
                    "-map", "[aout]", "-t", f"{DURATION}", out], check=True)
    for name in ("voice", "music"):
        os.remove(stem(name))
print("wrote", out)
