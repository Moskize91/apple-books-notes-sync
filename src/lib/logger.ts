import type { LogLevel } from "./types";

export type LogHandler = (level: LogLevel, message: string) => void;

let logHandler: LogHandler | null = null;

export function setLogHandler(handler: LogHandler | null): () => void {
  const previous = logHandler;
  logHandler = handler;
  return () => {
    logHandler = previous;
  };
}

export function log(level: LogLevel, message: string): void {
  if (logHandler) {
    logHandler(level, message);
    return;
  }

  const prefix = level.toUpperCase();
  const line = `[${prefix}] ${message}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
