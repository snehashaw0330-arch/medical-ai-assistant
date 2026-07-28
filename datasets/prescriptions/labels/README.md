# Ground-truth labels for prescription OCR

One JSON file per prescription image, named `<image-stem>.json`. These are the only thing that
makes an accuracy claim meaningful — see `docs/PRESCRIPTION_OCR_OVERHAUL.md` §1.2 for why the
previous "accuracy" metric was not one.

## Schema

```json
{
  "image": "016e98c0.jpg",
  "image_path": "backend/history/images/016e98c0.jpg",
  "source": "real-handwritten",
  "split": "handwritten",
  "certain": true,
  "raw_text": "optional full-page transcription, used for CER/WER",
  "patient": { "age": "6 months", "weight_kg": 6.6, "sex": "F" },
  "medicines": [
    {
      "name": "T-Minic",
      "strength": null,
      "form": "drops",
      "frequency": "0.3ml-0.3ml-0.3ml",
      "duration": null,
      "certain": true
    }
  ]
}
```

### Fields

| field | meaning |
|---|---|
| `split` | `handwritten` \| `printed` \| `mixed` — scores are reported per split |
| `certain` (top level) | `false` if the transcriber could not read the page confidently; excluded from headline scores |
| `certain` (per medicine) | `false` for an item whose name could not be read with confidence; counted separately so it never silently inflates or deflates recall |
| `raw_text` | optional. Omit it and CER/WER are skipped for that image (coverage is reported) |
| `strength`/`form`/`frequency`/`duration` | `null` when not written on the page — not when merely unreadable (use `certain: false` for that) |

## Rules for transcribers

1. **Transcribe what is on the page, not what is plausible.** If the drug makes no clinical
   sense for the patient, still record what is written.
2. If a name is ambiguous, set `"certain": false` on that medicine and record your best reading.
   Do not guess silently — an unmarked wrong label is worse than no label.
3. `name` is the drug name only. Strength (`650mg`), form (`drops`, `cream`, `syrup`) and
   schedule go in their own fields.
4. Frequency verbatim where possible (`0-0-1`, `TDS`, `twice daily`); the harness normalises.

## Target set (per the overhaul plan)

≥100 prescriptions: **60 handwritten / 25 printed / 15 poor-quality-or-mixed**.
Currently seeded: 4 (3 synthetic printed, 1 real handwritten). Scaling this is the
highest-value task in Phase 0 — every later phase is scored against it.

Run `./venv/bin/python -m backend.ocr.benchmark` to score the current pipeline.
