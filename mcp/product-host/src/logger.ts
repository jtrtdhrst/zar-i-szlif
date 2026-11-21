// Minimal leveled logger. Every message passes through a redaction step so a
// bearer token or a JWT secret can never reach the log stream even if a caller
// passes one by accident.

import type { LogLevel } from "./config.ts";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
];

export function redact(value: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LogSink {
  (line: string): void;
}

function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    parts.push(`${key}=${rendered}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function createLogger(level: LogLevel, sink: LogSink = (line) => console.log(line)): Logger {
  const threshold = ORDER[level];
  const emit = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[entryLevel] < threshold) return;
    sink(redact(`[${entryLevel}] ${message}${fields ? formatFields(fields) : ""}`));
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
