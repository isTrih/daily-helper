import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { formatWithOptions } from "node:util";

const hourMs = 60 * 60 * 1000;
const retainedHours = 48;
const logNamePattern = /^app-(\d{4}-\d{2}-\d{2}T\d{2})\.log$/;
const levels = ["debug", "log", "info", "warn", "error"] as const;
type LogLevel = typeof levels[number];

function hourStart(now: Date) {
  return Math.floor(now.getTime() / hourMs) * hourMs;
}

export function createApplicationLogStore(dir: string) {
  let cleanedHour: number | undefined;

  function prune(now: Date) {
    const current = hourStart(now);
    if (current === cleanedHour) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const cutoff = current - (retainedHours - 1) * hourMs;
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const stamp = file.isFile() ? logNamePattern.exec(file.name)?.[1] : undefined;
      if (!stamp || !(Date.parse(`${stamp}:00:00Z`) < cutoff)) continue;
      try { unlinkSync(join(dir, file.name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    cleanedHour = current;
  }

  return {
    prune,
    append(now: Date, level: LogLevel, message: string) {
      prune(now);
      const timestamp = now.toISOString();
      try {
        appendFileSync(
          join(dir, `app-${timestamp.slice(0, 13)}.log`),
          `${timestamp} [${level.toUpperCase()}] ${message.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}\n`,
          { mode: 0o600 },
        );
      } catch (error) {
        cleanedHour = undefined;
        throw error;
      }
    },
  };
}

function logValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const frames = value.stack?.split("\n").filter(line => /^\s+at /.test(line)) ?? [];
    return [`${value.name}: ${value.message}`, ...frames].join("\n");
  }
  if (Array.isArray(value) && depth < 3) return value.map(item => logValue(item, depth + 1));
  if (value && typeof value === "object") return "[结构化对象已省略]";
  return value;
}

export function installApplicationLogger(dir: string, secrets: (string | undefined)[]) {
  const store = createApplicationLogStore(dir);
  const originals = { debug: console.debug, log: console.log, info: console.info, warn: console.warn, error: console.error };
  const sensitiveValues = [...new Set(secrets.filter((value): value is string => !!value))].sort((a, b) => b.length - a.length);
  let storageFailed = false;
  let timer: ReturnType<typeof setTimeout>;

  function persist(action: () => void) {
    try { action(); storageFailed = false; }
    catch {
      if (!storageFailed) originals.error.call(console, "[log] 无法写入或清理日志文件，请检查日志目录和磁盘空间");
      storageFailed = true;
    }
  }

  function rotate() {
    const now = new Date();
    persist(() => store.prune(now));
    timer = setTimeout(rotate, hourStart(now) + hourMs - now.getTime() + 10);
    timer.unref();
  }

  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      let message = formatWithOptions({ colors: false, customInspect: false }, ...args.map(value => logValue(value)));
      for (const secret of sensitiveValues) message = message.replaceAll(secret, "[REDACTED]");
      message = message
        .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, value => {
          try {
            const url = new URL(value);
            return `${url.origin}${url.pathname}`;
          } catch { return "[URL 已省略]"; }
        })
        .replace(/\b(?:authorization|(?:set-)?cookie|sessionid(?:_ss)?|(?:[a-z_]*_)?(?:token|secret|password))["']?\s*[:=][^\r\n]*/gi, "[凭证已省略]")
        .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]");
      originals[level].call(console, message);
      persist(() => store.append(new Date(), level, message));
    };
  }
  rotate();

  return () => {
    clearTimeout(timer);
    for (const level of levels) console[level] = originals[level];
  };
}
