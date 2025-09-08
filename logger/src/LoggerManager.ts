import { Logger, LogLevel, LoggerConfig } from './Logger';

export class LoggerManager {
  private static config: LoggerConfig = {
    level: LogLevel.INFO,
    console: true,
    file: process.env.NODE_ENV === 'production',
    json: process.env.NODE_ENV === 'production',
    timestamp: true,
    colorize: process.env.NODE_ENV !== 'production',
    dirname: process.env.LOG_DIR || './logs',
    maxFiles: '30d',
    maxSize: '100m'
  };
  
  static configure(config: Partial<LoggerConfig>): void {
    LoggerManager.config = { ...LoggerManager.config, ...config };
  }
  
  static getLogger(component: string): Logger {
    return Logger.getLogger(component, LoggerManager.config);
  }
  
  static setGlobalLevel(level: LogLevel): void {
    Logger.instances_.forEach(logger => logger.setLevel(level));
  }
  
  static isDevelopment(): boolean {
    return process.env.NODE_ENV !== 'production';
  }
  
  static isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
  
  static isTest(): boolean {
    return process.env.NODE_ENV === 'test';
  }
  
  static getConfig(): LoggerConfig {
    return { ...LoggerManager.config };
  }
  
  static reset(): void {
    Logger.instances_.clear();
  }
}

// Configuration par environnement
if (process.env.NODE_ENV === 'production') {
  LoggerManager.configure({
    level: LogLevel.WARN,
    console: false,
    file: true,
    json: true,
    colorize: false
  });
} else if (process.env.NODE_ENV === 'test') {
  LoggerManager.configure({
    level: LogLevel.ERROR,
    console: false,
    file: false
  });
} else {
  // Development
  LoggerManager.configure({
    level: LogLevel.DEBUG,
    console: true,
    file: false,
    colorize: true
  });
}

// Lecture des variables d'environnement
if (process.env.LOG_LEVEL) {
  LoggerManager.configure({
    level: process.env.LOG_LEVEL as LogLevel
  });
}

if (process.env.LOG_DIR) {
  LoggerManager.configure({
    dirname: process.env.LOG_DIR
  });
}

if (process.env.LOG_FILE === 'true') {
  LoggerManager.configure({
    file: true
  });
}

if (process.env.LOG_JSON === 'true') {
  LoggerManager.configure({
    json: true
  });
}

if (process.env.LOG_CONSOLE === 'false') {
  LoggerManager.configure({
    console: false
  });
}