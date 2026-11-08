# Expanded language evaluation — dataset version 2

The held-out test set increased from 142 to 551 audited utterances. Added 312 action constructions and 100 unsupported/non-command requests before overlap exclusions. Existing and new exact duplicates are recorded in the JSON report and excluded from scoring. Test-only additions never enter seed training, replay packaging or personal learning.

The existing pretrained seed was evaluated without changing its weights. A larger sample changes the measured score; it does not demonstrate an improvement from training.

| Category | Correct | Total | Accuracy |
|---|---:|---:|---:|
| Supported actions | 368 | 387 | 95.09% |
| Unsupported/non-command requests | 137 | 164 | 83.54% |
| Overall | 505 | 551 | 91.65% |

Coverage includes all 26 supported action labels and the `other` label. Supported-action coverage is 14–15 distinct utterances per label after exclusions, still below the design's 80-per-label release requirement. Unsupported coverage is 164 cases, below the 500-case requirement. Classifier-only precision should not be confused with executable action accuracy: the coordinator separately applies speech-act guards, field validation and confirmation.

Twenty-one new automated checks cover split leakage, all-label coverage, negation/reported speech/quoted commands, exact note text and Unicode preservation, browser query preservation, and ambiguous meeting times without early writes. These checks use the existing seed and isolated databases; browser calls use a recording fake.

## Reproduce

```sh
npm run kst:ml:evaluate
node --test packages/kst-core/test/understanding/expanded-evaluation.test.mjs
```

Per-case predictions, readable expected/predicted intents, per-class counts, excluded duplicates and chronological diagnostics are in `packages/kst-core/resources/understanding/release-corpus-report.json`. These diagnostic test labels must not be fed into training to improve the reported score.

The existing local user-preview activation is preserved. Release approval is still incomplete; no GitHub push occurred.
