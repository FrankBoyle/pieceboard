import fs from 'node:fs/promises';
import { evaluateButtons } from '../evaluation/evaluate.js';

const dataset = JSON.parse(await fs.readFile(new URL('../evaluation/button-cases.json', import.meta.url), 'utf8'));
const result = evaluateButtons(dataset);
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Synthetic development set: ${result.cases.length} cases, ${result.totals.tp} true positives, ${result.totals.fp} false positives, ${result.totals.fn} false negatives.`);
  console.log(`Precision: ${result.precision === null ? 'not defined' : `${(100 * result.precision).toFixed(1)}%`}; recall: ${result.recall === null ? 'not defined' : `${(100 * result.recall).toFixed(1)}%`}.`);
  for (const sample of result.cases.filter((item) => item.fp || item.fn)) console.log(`- ${sample.id}: expected [${sample.expected.join(', ')}], reported [${sample.predicted.join(', ')}]. ${sample.description}`);
  console.log('This small, hand-authored development set is not a held-out or representative accuracy study.');
}
