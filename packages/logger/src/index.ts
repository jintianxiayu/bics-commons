export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export interface LoggerOptions {
    level?: LogLevel;
    prefix?: string;
}

export class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(options: LoggerOptions = {}) {
        this.level = options.level ?? LogLevel.INFO;
        this.prefix = options.prefix ?? '';
    }

    debug(message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, message, args);
    }

    info(message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, message, args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, message, args);
    }

    error(message: string, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, message, args);
    }

    private log(level: LogLevel, message: string, args: unknown[]): void {
        if (level < this.level) return;

        const timestamp = new Date().toISOString();
        const levelName = LogLevel[level];
        const prefix = this.prefix ? `[${this.prefix}] ` : '';

        console.log(`${timestamp} ${levelName}: ${prefix}${message}`, ...args);
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }
}

export function createLogger(options?: LoggerOptions): Logger {
    return new Logger(options);
}
