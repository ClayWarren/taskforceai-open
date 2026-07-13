import type {
  LogContext,
  LogEntry,
  LogLevel,
  LogMetadata,
  LogTransport,
  LoggerOptions,
} from './types';

const PRIO: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const flatErr = (e: Error) => ({
  name: e.name,
  message: e.message,
  stack: e.stack,
  ...Object.fromEntries(
    Object.getOwnPropertyNames(e)
      .filter((k) => !['name', 'message', 'stack'].includes(k))
      .map((k) => [k, (e as unknown as Record<string, unknown>)[k]])
  ),
});

const normVal = (v: unknown, seen = new Set()): unknown => {
  if (v instanceof Error) return flatErr(v);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    const res = Array.isArray(v)
      ? v.map((i) => normVal(i, seen))
      : Object.fromEntries(Object.entries(v).map(([k, val]) => [k, normVal(val, seen)]));
    seen.delete(v);
    return res;
  }
  return v;
};

const isLogMetadata = (value: unknown): value is LogMetadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normMeta = (m: unknown): LogMetadata | undefined => {
  if (m === undefined) return undefined;
  if (m instanceof Error) return { error: flatErr(m) };
  const n = normVal(m);
  return isLogMetadata(n) ? n : { value: n };
};

const safeErr = (m: string, x?: unknown) => {
  const p = { level: 'error', message: m, timestamp: new Date().toISOString(), ...normMeta(x) };
  if (typeof process !== 'undefined' && process.stderr) {
    process.stderr.write(`${JSON.stringify(p)}\n`);
  }
};

export class Logger {
  private level: LogLevel;
  private context: LogContext;
  private transports: LogTransport[];
  private buffer: LogEntry[] = [];
  private max: number;

  constructor(o: LoggerOptions = {}) {
    this.level = o.level ?? 'debug';
    this.context = o.context ?? {};
    this.transports = [...(o.transports ?? [])];
    this.max = o.maxBufferSize ?? 100;
  }

  setLevel(l: LogLevel) {
    this.level = l;
  }

  setContext(c: LogContext) {
    this.context = { ...c };
  }

  mergeContext(c: LogContext) {
    this.context = { ...this.context, ...c };
  }

  addTransport(t: LogTransport) {
    this.transports.push(t);
  }

  clearTransports() {
    this.transports = [];
  }

  child(c: LogContext) {
    return new Logger({
      level: this.level,
      transports: this.transports,
      maxBufferSize: this.max,
      context: { ...this.context, ...c },
    });
  }

  debug(m: string, x?: unknown) {
    this.log('debug', m, x);
  }

  info(m: string, x?: unknown) {
    this.log('info', m, x);
  }

  warn(m: string, x?: unknown) {
    this.log('warn', m, x);
  }

  error(m: string, x?: unknown) {
    this.log('error', m, x);
  }

  log(l: LogLevel, m: string, x?: unknown) {
    if (PRIO[l] < PRIO[this.level]) return;
    const meta = normMeta(x);
    const e: LogEntry = {
      level: l,
      message: m,
      context: this.context,
      timestamp: new Date().toISOString(),
      ...(meta && { metadata: meta }),
    };
    this.buffer.push(e);
    if (this.buffer.length > this.max) this.buffer.shift();
    this.transports.forEach((t) => {
      try {
        const r = t.log(e);
        if (r instanceof Promise)
          r.catch((err) =>
            safeErr('Logger transport failed (async)', { transport: t.name, error: err })
          );
      } catch (err) {
        safeErr('Logger transport failed', { transport: t.name, error: err });
      }
    });
  }

  getBuffer() {
    return [...this.buffer];
  }

  clearBuffer() {
    this.buffer = [];
  }

  async flush() {
    const pending: Promise<void>[] = [];

    for (const transport of this.transports) {
      if (typeof transport.flush !== 'function') {
        continue;
      }

      try {
        pending.push(
          Promise.resolve(transport.flush()).catch((error: unknown) => {
            safeErr('Logger transport flush failed (async)', { transport: transport.name, error });
          })
        );
      } catch (error) {
        safeErr('Logger transport flush failed', { transport: transport.name, error });
      }
    }

    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }
}
