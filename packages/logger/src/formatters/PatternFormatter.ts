import winston from 'winston';
import { LogMessage } from '../types';
import { getLogPosition } from '../core/LogPosition';

const PLACEHOLDERS = {
  timestamp: (info: winston.Logform.TransformableInfo) => info.timestamp as string,
  level: (info: winston.Logform.TransformableInfo) => info.level.toUpperCase(),
  name: (info: winston.Logform.TransformableInfo) => info.label || '',
  message: (info: winston.Logform.TransformableInfo) => info.message as string,
  meta: (info: winston.Logform.TransformableInfo) => {
    const meta = Object.keys(info)
      .filter(key => !['timestamp', 'level', 'message', 'label'].includes(key))
      .reduce((obj, key) => ({ ...obj, [key]: info[key] }), {});
    return Object.keys(meta).length ? JSON.stringify(meta) : '';
  },
  log_position: () => getLogPosition(),
};

export const createPatternFormatter = (pattern: string): winston.Logform.Format => {
  return winston.format.printf(info => {
    let result = pattern;
    for (const [key, resolver] of Object.entries(PLACEHOLDERS)) {
      const placeholder = `%{${key}}`;
      if (result.includes(placeholder)) {
        result = result.replace(placeholder, resolver(info)?.toString() || '');
      }
    }
    return result;
  });
};