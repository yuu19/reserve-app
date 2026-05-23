import { appendFile, readFile } from 'node:fs/promises';

const coverageTargets = process.argv.slice(2);

if (coverageTargets.length === 0) {
  throw new Error('Pass at least one coverage target as "Label=path/to/coverage-summary.json".');
}

const formatPercent = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(2)}%`;
};

const readCoverageRow = async (target) => {
  const separatorIndex = target.indexOf('=');

  if (separatorIndex <= 0 || separatorIndex === target.length - 1) {
    throw new Error(
      `Invalid coverage target "${target}". Use "Label=path/to/coverage-summary.json".`,
    );
  }

  const label = target.slice(0, separatorIndex);
  const filePath = target.slice(separatorIndex + 1);
  const summary = JSON.parse(await readFile(filePath, 'utf8'));
  const total = summary.total;

  if (!total) {
    throw new Error(`Coverage summary "${filePath}" does not contain a total section.`);
  }

  return [
    label,
    formatPercent(total.lines?.pct),
    formatPercent(total.statements?.pct),
    formatPercent(total.functions?.pct),
    formatPercent(total.branches?.pct),
  ];
};

const rows = await Promise.all(coverageTargets.map(readCoverageRow));
const markdown = [
  '## Vitest Coverage',
  '',
  '| Target | Lines | Statements | Functions | Branches |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...rows.map((row) => `| ${row.join(' | ')} |`),
  '',
  'Coverage thresholds are not configured for this CI job.',
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
}

console.log(markdown);
