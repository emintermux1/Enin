type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

function write(level: LogLevel, ...args: unknown[]) {
  const line = `[${new Date().toISOString()}] [${level}]`
  if (level === 'ERROR') {
    console.error(line, ...args)
    return
  }
  if (level === 'WARN') {
    console.warn(line, ...args)
    return
  }
  console.log(line, ...args)
}

export const logger = {
  info: (...args: unknown[]) => write('INFO', ...args),
  warn: (...args: unknown[]) => write('WARN', ...args),
  error: (...args: unknown[]) => write('ERROR', ...args),
  debug: (...args: unknown[]) => write('DEBUG', ...args),
}
