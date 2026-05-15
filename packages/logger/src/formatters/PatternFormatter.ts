import winston from 'winston';
import { LogMessage } from '../types';
import { getLogPosition } from '../core/LogPosition';

const PLACEHOLDERS = {
  timestamp: (info: winston.Logform.TransformableInfo) => info.timestamp as string,
  level: (info: winston.Logform.TransformableInfo) => info.level.toUpperCase(),
  name: (info: winston.Logform.TransformableInfo) => info.label || '',
  message: (info: winston.Logform.TransformableInfo) => info.message as string,
  meta: (info: winston.Logform.TransformableInfo) => {
    const meta: Record<string, unknown> = {};
    for (const key of Object.keys(info)) {
      if (!['timestamp', 'level', 'message', 'label'].includes(key)) {
        meta[key] = info[key];
      }
    }
    const metaStr = JSON.stringify(meta);
    return metaStr === '{}' ? '' : metaStr;
  },
  log_position: () => getLogPosition(),
};

export const createPatternFormatter = (pattern: string): winston.Logform.Format => {
  return winston.format.printf(info => {
    let result = pattern;
    for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
      const placeholder = `%{${key}}`;
      if (result.includes(placeholder)) {
        result = result.replaceAll(placeholder, resolver(info)?.toString() || '');
      }
    }
    return result;
  });
};