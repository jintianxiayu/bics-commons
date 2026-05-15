import stackTrace from 'stacktrace-parser';

export const getLogPosition = (): string => {
  const stack = stackTrace.parse(new Error().stack!);
  // stack[0] = Error
  // stack[1] = getLogPosition
  // stack[2] = log method caller (Logger.info/debug/info/error)
  // stack[3] = actual caller (user code)
  const caller = stack[3];
  if (!caller) {
    return 'unknown:0:0';
  }
  // 移除 Node.js 内部路径，只保留相对路径
  const fileName = (caller.file || '').replace(/^.*packages[\\/]logger[\\/]src/, 'src');
  return `${fileName}:${caller.lineNumber || 0}:${caller.column || 0}`;
};
