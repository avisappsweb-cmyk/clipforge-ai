#!/usr/bin/env python3
"""CLIPFORGE local ASR sidecar.

Runs the Vosk offline speech-recognition model on a 16 kHz mono PCM WAV and
emits JSON with word-level timestamps plus an RMS energy envelope.

Output JSON:
{
  "language": "en",
  "provider": "local-vosk",
  "text": "...",
  "words":  [{"word","start","end","conf"}...],
  "segments":[{"start","end","text","words":[...]}...],
  "energy": {"hop": 0.05, "values": [float,...]},
  "speech_regions": [{"start","end"}...]
}

This tool NEVER fabricates words: only recognized speech is emitted.
"""
import json
import math
import os
import struct
import sys
import wave


def rms_envelope(pcm_bytes, sample_rate, hop_sec=0.05):
    hop = max(1, int(sample_rate * hop_sec))
    n = len(pcm_bytes) // 2
    values = []
    for i in range(0, n, hop):
        end = min(i + hop, n)
        if end - i < hop // 4:
            break
        count = end - i
        acc = 0.0
        offset = i * 2
        for j in range(0, count * 2, 2):
            s = struct.unpack_from('<h', pcm_bytes, offset + j)[0]
            acc += s * s
        values.append(math.sqrt(acc / count) / 32768.0)
    return values


def speech_regions(energy, hop_sec, floor_ratio=2.2, min_speech=0.25, merge_gap=0.35):
    if not energy:
        return []
    sorted_vals = sorted(energy)
    noise = sorted_vals[max(0, int(len(sorted_vals) * 0.15))]
    peak = sorted_vals[-1]
    if peak <= 1e-6:
        return []
    threshold = max(noise * floor_ratio, peak * 0.07, 0.008)
    regions = []
    start = None
    for i, v in enumerate(energy):
        t0 = i * hop_sec
        if v >= threshold:
            if start is None:
                start = t0
        else:
            if start is not None:
                regions.append([start, t0])
                start = None
    if start is not None:
        regions.append([start, len(energy) * hop_sec])
    merged = []
    for r in regions:
        if merged and r[0] - merged[-1][1] < merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(list(r))
    return [r for r in merged if r[1] - r[0] >= min_speech]


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: vosk_asr.py MODEL_DIR WAV_PATH [LANGUAGE]"}))
        sys.exit(2)
    model_dir, wav_path = sys.argv[1], sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else "en"

    if not os.path.isdir(model_dir):
        print(json.dumps({"error": f"ASR model not found at {model_dir}. Run npm run setup:models."}))
        sys.exit(3)

    try:
        wf = wave.open(wav_path, "rb")
    except Exception as e:
        print(json.dumps({"error": f"cannot open wav: {e}"}))
        sys.exit(4)

    if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
        print(json.dumps({"error": "expected 16-bit mono wav"}))
        sys.exit(4)
    sample_rate = wf.getframerate()

    pcm = wf.readframes(wf.getnframes())
    wf.close()

    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)

    model = Model(model_dir)
    rec = KaldiRecognizer(model, sample_rate)
    rec.SetWords(True)

    chunk = int(sample_rate * 0.2)
    words = []
    for i in range(0, len(pcm), chunk * 2):
        data = pcm[i:i + chunk * 2]
        if rec.AcceptWaveform(data):
            part = json.loads(rec.Result())
            words.extend(part.get("result", []))
    final = json.loads(rec.FinalResult())
    words.extend(final.get("result", []))

    words.sort(key=lambda w: w["start"])
    for w in words:
        w["conf"] = round(float(w.get("conf", 0.0)), 3)

    segments = []
    pause_gap = 0.6
    for w in words:
        if segments and w["start"] - segments[-1]["end"] >= pause_gap:
            segments.append({"start": w["start"], "end": w["end"], "text": w["word"], "words": [w]})
        elif segments:
            seg = segments[-1]
            seg["end"] = w["end"]
            seg["text"] += " " + w["word"]
            seg["words"].append(w)
        else:
            segments.append({"start": w["start"], "end": w["end"], "text": w["word"], "words": [w]})

    energy = rms_envelope(pcm, sample_rate)
    regions = speech_regions(energy, 0.05)

    out = {
        "language": language,
        "provider": "local-vosk",
        "text": " ".join(w["word"] for w in words),
        "words": words,
        "segments": [
            {
                "start": round(s["start"], 3),
                "end": round(s["end"], 3),
                "text": s["text"],
                "words": s["words"],
            }
            for s in segments
        ],
        "energy": {"hop": 0.05, "values": [round(v, 5) for v in energy]},
        "speech_regions": [{"start": round(a, 3), "end": round(b, 3)} for a, b in regions],
        "diarization": "unsupported",
    }
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
