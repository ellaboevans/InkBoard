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
"""
import json
import os
import subprocess

FFMPEG = "/opt/homebrew/bin/ffmpeg"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.expanduser("~/Movies/InkBoard-video/music/kevin-macleod/Inspired.mp3")
DURATION = 35.0

placement = json.load(open(os.path.join(HERE, "src/data/placement.json")))
timing = json.load(open(os.path.join(HERE, "src/data/voice-timing.json")))
lines = [(l["file"], placement[l["id"]]) for l in timing["lines"]]

inputs, chains = [], []
for k, (file, at) in enumerate(lines):
    inputs += ["-i", os.path.join(HERE, "tmp/voice", file)]
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
out = os.path.join(HERE, "tmp/soundtrack.wav")
subprocess.run([FFMPEG, "-v", "error", "-y"] + inputs + ["-filter_complex", ";".join(chains), "-map", "[aout]",
                "-t", f"{DURATION}", out], check=True)
print("wrote", out)
