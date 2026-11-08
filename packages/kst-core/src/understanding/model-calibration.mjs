import { AUTOMATIC_LABELS } from './registry.mjs';
import { predict } from './model.mjs';

/** Fit read/web thresholds exclusively on the explicitly supplied calibration split.
 * Mutation policies always remain disabled. Scores are margins, not probabilities.
 */
export function calibratePolicies(model, records) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('Invalid calibration corpus');
  const observations = records.map(record => {
    if (record.partition !== 'calibration') throw new Error('Calibration split required');
    if (!Number.isInteger(record.label) || record.label < 0 || record.label > 26) throw new Error('Invalid calibration label');
    const result = predict(model, record.features);
    return { predicted: result.top[0].label, score: result.top[0].score, margin: result.margin, correct: result.top[0].label === record.label };
  });
  const policies = Array.from({ length: 32 }, () => ({ scoreFloor: 0, marginFloor: 0, automaticEnabled: false }));
  const evidence = [];
  let acceptedTotal = 0;
  for (const label of AUTOMATIC_LABELS) {
    const rows = observations.filter(row => row.predicted === label);
    const floors = [...new Set(rows.map(row => Math.ceil(row.score * 100) / 100))];
    const margins = [...new Set(rows.map(row => Math.ceil(row.margin * 100) / 100))];
    let best;
    for (const scoreFloor of floors) {
      for (const marginFloor of margins) {
        // Match the production 1e-4 boundary guard: equality must clarify.
        const accepted = rows.filter(row => row.score - scoreFloor > 1e-4 && row.margin - marginFloor > 1e-4);
        const correct = accepted.filter(row => row.correct).length;
        if (correct < 10 || correct / accepted.length < .98) continue;
        const choice = { scoreFloor, marginFloor, correct, total: accepted.length };
        if (!best || correct > best.correct || (correct === best.correct && (marginFloor > best.marginFloor || (marginFloor === best.marginFloor && scoreFloor > best.scoreFloor)))) best = choice;
      }
    }
    if (best) {
      policies[label] = { scoreFloor: best.scoreFloor, marginFloor: best.marginFloor, automaticEnabled: true };
      acceptedTotal += best.total;
      evidence.push({ label, ...best });
    }
  }
  if (acceptedTotal < 100) for (const policy of policies) policy.automaticEnabled = false;
  return { policies, evidence, acceptedTotal, minimumOverallMet: acceptedTotal >= 100 };
}
ëŽ