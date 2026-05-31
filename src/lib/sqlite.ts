import { execFileSync } from "node:child_process";

let sqliteCommand = "sqlite3";

export function setSqliteCommand(command: string): void {
  sqliteCommand = command;
}

export function querySqlite<T>(dbPath: string, sql: string): T[] {
  const output = execFileSync(sqliteCommand, ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (output.trim().length === 0) {
    return [];
  }

  return JSON.parse(output) as T[];
}

export function sqliteVersion(): string {
  return execFileSync(sqliteCommand, ["--version"], {
    encoding: "utf8",
  }).trim();
}
