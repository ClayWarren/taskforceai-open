export interface LcovRecord {
  sourceFile: string;
  functionName: string;
  functionFound: number;
  functionHit: number;
  lineData: Map<number, number>;
  linesFound: number;
  linesHit: number;
  sources: Set<string>;
}

export type LcovMode = 'logic' | 'combined';

function parseCount(value: string, fallbackInvalidCounts: boolean): number {
  const parsed = Number.parseInt(value, 10);
  return fallbackInvalidCounts ? parsed || 0 : parsed;
}

export function parseLcov(
  content: string,
  sourceName?: string,
  fallbackInvalidCounts = false
): Map<string, LcovRecord> {
  const records = new Map<string, LcovRecord>();
  let currentRecord: LcovRecord | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [prefix, ...rest] = trimmed.split(':');
    const value = rest.join(':');

    switch (prefix) {
      case 'SF':
        currentRecord = {
          sourceFile: value,
          functionName: '',
          functionFound: 0,
          functionHit: 0,
          lineData: new Map(),
          linesFound: 0,
          linesHit: 0,
          sources: new Set(sourceName ? [sourceName] : []),
        };
        records.set(value, currentRecord);
        break;
      case 'FN':
        if (currentRecord) currentRecord.functionName = value.split(',')[1] || value;
        break;
      case 'FNF':
        if (currentRecord) {
          currentRecord.functionFound = parseCount(value, fallbackInvalidCounts);
        }
        break;
      case 'FNH':
        if (currentRecord) currentRecord.functionHit = parseCount(value, fallbackInvalidCounts);
        break;
      case 'DA': {
        if (currentRecord) {
          const [lineNumberRaw, hitCountRaw] = value.split(',');
          const lineNumber = Number.parseInt(lineNumberRaw ?? '', 10);
          const hitCount = Number.parseInt(hitCountRaw ?? '', 10);
          if (Number.isFinite(lineNumber) && Number.isFinite(hitCount)) {
            currentRecord.lineData.set(
              lineNumber,
              (currentRecord.lineData.get(lineNumber) ?? 0) + hitCount
            );
          }
        }
        break;
      }
      case 'LF':
        if (currentRecord) currentRecord.linesFound = Number.parseInt(value, 10);
        break;
      case 'LH':
        if (currentRecord) currentRecord.linesHit = Number.parseInt(value, 10);
        break;
    }
  }

  return records;
}

export function mergeLcovRecords(
  target: Map<string, LcovRecord>,
  source: Map<string, LcovRecord>,
  mode: LcovMode
): void {
  for (const [sourceFile, record] of source) {
    const existing = target.get(sourceFile);
    if (!existing) {
      target.set(sourceFile, {
        ...record,
        lineData: new Map(record.lineData),
        sources: new Set(record.sources),
      });
      continue;
    }

    for (const [lineNumber, hitCount] of record.lineData) {
      existing.lineData.set(lineNumber, (existing.lineData.get(lineNumber) ?? 0) + hitCount);
    }
    existing.functionHit = Math.max(existing.functionHit, record.functionHit);
    for (const sourceName of record.sources) existing.sources.add(sourceName);

    if (mode === 'logic') {
      existing.functionFound = Math.max(existing.functionFound, record.functionFound);
      if (!existing.functionName) existing.functionName = record.functionName;
    } else {
      existing.linesHit = Math.max(existing.linesHit, record.linesHit);
    }
  }
}

export function toLcov(records: Map<string, LcovRecord>, mode: LcovMode): string {
  const lines: string[] = [];
  const values = Array.from(records.values());
  const orderedRecords =
    mode === 'logic' ? values.toSorted((a, b) => a.sourceFile.localeCompare(b.sourceFile)) : values;

  for (const record of orderedRecords) {
    const lineData = Array.from(record.lineData.entries()).toSorted(([a], [b]) => a - b);
    const linesFound = mode === 'logic' ? lineData.length : record.linesFound;
    const linesHit =
      mode === 'logic' ? lineData.filter(([, hitCount]) => hitCount > 0).length : record.linesHit;

    lines.push('TN:', `SF:${record.sourceFile}`);
    if (record.functionName) lines.push(`FN:0,${record.functionName}`);
    lines.push(`FNF:${record.functionFound}`, `FNH:${record.functionHit}`);
    for (const [lineNumber, hitCount] of lineData) lines.push(`DA:${lineNumber},${hitCount}`);
    lines.push(`LF:${linesFound}`, `LH:${linesHit}`, 'end_of_record');
  }

  const output = lines.join('\n');
  return mode === 'logic' ? `${output}\n` : output;
}
