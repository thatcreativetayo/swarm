export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

function write(level: LogLevel, message: string, data?: unknown): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope: "swarm",
    message,
    ...(data === undefined ? {} : { data }),
  };
  const output = JSON.stringify(line);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export const logger: Logger = {
  debug: (message, data) => {
    if (process.env.SWARM_LOG_LEVEL === "debug") write("debug", message, data);
  },
  info: (message, data) => write("info", message, data),
  warn: (message, data) => write("warn", message, data),
  error: (message, data) => write("error", message, data),
};
