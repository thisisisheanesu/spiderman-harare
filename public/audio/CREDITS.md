# Voice audio credits

The NPC voices and the crowd ambience in this game are real recordings of Shona speakers from Zimbabwe,
recorded for Google's **FLEURS** speech dataset (locale `sn_zw`). Nothing was synthesised: the clips are
trimmed, lightly cleaned (90 Hz high-pass, mild FFT denoise), loudness-matched and packed into audio sprites
by `tools/build_voices.py`. The crowd bed layers many of the same recordings at low level (with a small
speed/pitch spread, a 4 kHz low-pass and a short room echo) so that no single sentence is intelligible.

| File | Contents |
|------|----------|
| `voices_f.mp3`, `voices_m.mp3` | 215 clips (60 female lines, 60 male lines, 45 female barks, 50 male barks); offsets, Shona text and English translations in `voices.json` |
| `crowd_loop.mp3` | 45 s seamless loop of layered Shona chatter (28 utterances) |

## Speech: FLEURS

- Dataset: FLEURS - Few-shot Learning Evaluation of Universal Representations of Speech, Shona (`sn_zw`),
  dev and test splits. <https://huggingface.co/datasets/google/fleurs>
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
  <https://creativecommons.org/licenses/by/4.0/>
- Paper: Alexis Conneau, Min Ma, Simran Khanuja, Yu Zhang, Vera Axelrod, Siddharth Dalmia, Jason Riesa,
  Clara Rivera, Ankur Bapna. *FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech.*
  IEEE Spoken Language Technology Workshop (SLT) 2022. arXiv:2205.12446 <https://arxiv.org/abs/2205.12446>

```bibtex
@article{fleurs2022arxiv,
  title   = {FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech},
  author  = {Conneau, Alexis and Ma, Min and Khanuja, Simran and Zhang, Yu and Axelrod, Vera and Dalmia, Siddharth
             and Riesa, Jason and Rivera, Clara and Bapna, Ankur},
  journal = {arXiv preprint arXiv:2205.12446},
  url     = {https://arxiv.org/abs/2205.12446},
  year    = {2022}
}
```

## Sentences: FLoRes

The speakers read sentences from the FLoRes-101 benchmark (translations of English Wikipedia sentences).
The Shona text (`sn`) is the FLEURS transcription; the English text (`en`) is the matching FLoRes English
sentence, licensed **CC BY-SA 4.0** <https://creativecommons.org/licenses/by-sa/4.0/>.
Goyal et al., *The FLORES-101 Evaluation Benchmark for Low-Resource and Multilingual Machine Translation*, 2021.
<https://github.com/facebookresearch/flores>

## Changes made

Selection of a subset of utterances (content curated to everyday/neutral topics), trimming of silence,
cutting of short fragments at natural pauses ("barks"), splitting of some two-sentence utterances at the
sentence pause, high-pass filtering, FFT denoising, loudness normalisation with peak limiting, 15 ms fades,
resampling to 24 kHz, MP3 encoding and concatenation into sprites; for the crowd loop additionally mixing,
panning, speed change (+/-6 %), low-pass filtering and echo. Bark subtitles (`approx: true`) are estimated
from timing and may be off by a word.

This is a non-commercial fan project and is not endorsed by Google, Meta, or the speakers.
