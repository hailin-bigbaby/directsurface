export interface TextToken {
  startColumn: number
  endColumn: number
  type: string
}

export interface TokenizeLineInput {
  line: string
  lineNumber: number
  previousState?: unknown
}

export interface TokenizeLineResult {
  tokens: TextToken[]
  endState?: unknown
}

export interface TextTokenizer {
  readonly languageId: string
  tokenizeLine(input: TokenizeLineInput): TokenizeLineResult
}

export const plainTextTokenizer: TextTokenizer = {
  languageId: 'plain',
  tokenizeLine: input => ({
    tokens: input.line.length > 0
      ? [{ startColumn: 0, endColumn: input.line.length, type: 'text' }]
      : [],
  }),
}

export const jsonTextTokenizer: TextTokenizer = {
  languageId: 'json',
  tokenizeLine: input => ({ tokens: tokenizeJsonLine(input.line) }),
}

export const javascriptTextTokenizer: TextTokenizer = {
  languageId: 'javascript',
  tokenizeLine: input => ({ tokens: tokenizeJavaScriptLine(input.line) }),
}

export const shellTextTokenizer: TextTokenizer = {
  languageId: 'shell',
  tokenizeLine: input => ({ tokens: tokenizeShellLine(input.line) }),
}

export const logTextTokenizer: TextTokenizer = {
  languageId: 'log',
  tokenizeLine: input => ({ tokens: tokenizeLogLine(input.line) }),
}

export function tokenizerForLanguage(languageId: string): TextTokenizer {
  const normalized = normalizeLanguageId(languageId)
  if (normalized === 'json') return jsonTextTokenizer
  if (normalized === 'javascript') return javascriptTextTokenizer
  if (normalized === 'shell') return shellTextTokenizer
  if (normalized === 'log') return logTextTokenizer
  return plainTextTokenizer
}

function normalizeLanguageId(languageId: string): string {
  const normalized = languageId.trim().toLowerCase()
  if (normalized === 'json' || normalized === 'jsonc') return 'json'
  if (normalized === 'js' || normalized === 'jsx' || normalized === 'javascript' ||
    normalized === 'ts' || normalized === 'tsx' || normalized === 'typescript') return 'javascript'
  if (normalized === 'bash' || normalized === 'sh' || normalized === 'shell' || normalized === 'zsh') return 'shell'
  if (normalized === 'log' || normalized === 'logs' || normalized === 'logfile') return 'log'
  return normalized
}

function tokenizeJsonLine(line: string): TextToken[] {
  const tokens: TextToken[] = []
  let column = 0
  while (column < line.length) {
    const ch = line[column]!
    if (isWhitespace(ch)) {
      column++
      continue
    }
    if (ch === '"') {
      const start = column
      column = consumeJsonString(line, column)
      let next = column
      while (next < line.length && isWhitespace(line[next]!)) next++
      tokens.push({
        startColumn: start,
        endColumn: column,
        type: line[next] === ':' ? 'property' : 'string',
      })
      continue
    }
    if (isNumberStart(ch)) {
      const start = column
      column = consumeJsonNumber(line, column)
      tokens.push({ startColumn: start, endColumn: column, type: 'number' })
      continue
    }
    if (isWordStart(ch)) {
      const start = column
      column = consumeWord(line, column)
      const word = line.slice(start, column)
      tokens.push({ startColumn: start, endColumn: column, type: jsonKeywordType(word) })
      continue
    }
    tokens.push({ startColumn: column, endColumn: column + 1, type: isJsonPunctuation(ch) ? 'punctuation' : 'text' })
    column++
  }
  return tokens
}

function consumeJsonString(line: string, start: number): number {
  let column = start + 1
  let escaped = false
  while (column < line.length) {
    const ch = line[column]!
    column++
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') break
  }
  return column
}

function consumeJsonNumber(line: string, start: number): number {
  let column = start
  while (column < line.length && /[0-9eE+\-.]/.test(line[column]!)) column++
  return column
}

function consumeWord(line: string, start: number): number {
  let column = start
  while (column < line.length && /[A-Za-z]/.test(line[column]!)) column++
  return column
}

function jsonKeywordType(word: string): string {
  return word === 'true' || word === 'false' || word === 'null' ? 'keyword' : 'text'
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

function isNumberStart(ch: string): boolean {
  return ch === '-' || (ch >= '0' && ch <= '9')
}

function isWordStart(ch: string): boolean {
  return /[A-Za-z]/.test(ch)
}

function isJsonPunctuation(ch: string): boolean {
  return ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ','
}

const javascriptKeywords = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'interface',
  'let', 'new', 'of', 'return', 'switch', 'throw', 'try', 'type', 'typeof',
  'var', 'void', 'while', 'with', 'yield',
])

const shellKeywords = new Set([
  'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if',
  'in', 'select', 'then', 'until', 'while',
])

function tokenizeJavaScriptLine(line: string): TextToken[] {
  const tokens: TextToken[] = []
  let column = 0
  while (column < line.length) {
    const ch = line[column]!
    const next = line[column + 1]
    if (isWhitespace(ch)) {
      column++
      continue
    }
    if (ch === '/' && next === '/') {
      tokens.push({ startColumn: column, endColumn: line.length, type: 'comment' })
      break
    }
    if (ch === '/' && next === '*') {
      const start = column
      const close = line.indexOf('*/', column + 2)
      column = close >= 0 ? close + 2 : line.length
      tokens.push({ startColumn: start, endColumn: column, type: 'comment' })
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      const start = column
      column = consumeQuotedString(line, column, ch)
      tokens.push({ startColumn: start, endColumn: column, type: 'string' })
      continue
    }
    if (isNumberStart(ch)) {
      const start = column
      column = consumeJavaScriptNumber(line, column)
      tokens.push({ startColumn: start, endColumn: column, type: 'number' })
      continue
    }
    if (isIdentifierStart(ch)) {
      const start = column
      column = consumeIdentifier(line, column)
      const word = line.slice(start, column)
      tokens.push({ startColumn: start, endColumn: column, type: javascriptWordType(word) })
      continue
    }
    tokens.push({ startColumn: column, endColumn: column + 1, type: isJavaScriptPunctuation(ch) ? 'punctuation' : 'operator' })
    column++
  }
  return tokens
}

function tokenizeShellLine(line: string): TextToken[] {
  const tokens: TextToken[] = []
  let column = 0
  while (column < line.length) {
    const ch = line[column]!
    if (isWhitespace(ch)) {
      column++
      continue
    }
    if (ch === '#') {
      tokens.push({ startColumn: column, endColumn: line.length, type: 'comment' })
      break
    }
    if (ch === '"' || ch === '\'') {
      const start = column
      column = consumeQuotedString(line, column, ch)
      tokens.push({ startColumn: start, endColumn: column, type: 'string' })
      continue
    }
    if (ch === '$') {
      const start = column
      column = consumeShellVariable(line, column)
      tokens.push({ startColumn: start, endColumn: column, type: 'variable' })
      continue
    }
    if (isNumberStart(ch)) {
      const start = column
      column = consumeJavaScriptNumber(line, column)
      tokens.push({ startColumn: start, endColumn: column, type: 'number' })
      continue
    }
    if (isIdentifierStart(ch)) {
      const start = column
      column = consumeShellWord(line, column)
      const word = line.slice(start, column)
      tokens.push({ startColumn: start, endColumn: column, type: shellKeywords.has(word) ? 'keyword' : 'text' })
      continue
    }
    tokens.push({ startColumn: column, endColumn: column + 1, type: isShellPunctuation(ch) ? 'punctuation' : 'operator' })
    column++
  }
  return tokens
}

function tokenizeLogLine(line: string): TextToken[] {
  const tokens: TextToken[] = []
  let column = 0
  while (column < line.length) {
    const ch = line[column]!
    if (isWhitespace(ch)) {
      column++
      continue
    }
    if (ch === '[' || ch === ']' || ch === '(' || ch === ')' || ch === ':' || ch === ',' || ch === '=') {
      tokens.push({ startColumn: column, endColumn: column + 1, type: ch === '=' ? 'operator' : 'punctuation' })
      column++
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      const start = column
      column = consumeQuotedString(line, column, ch)
      tokens.push({ startColumn: start, endColumn: column, type: 'log-value' })
      continue
    }
    if (isNumberStart(ch)) {
      const start = column
      column = consumeLogNumberOrTimestamp(line, column)
      tokens.push({ startColumn: start, endColumn: column, type: 'log-number' })
      continue
    }
    if (isIdentifierStart(ch)) {
      const start = column
      column = consumeLogWord(line, column)
      const word = line.slice(start, column)
      const next = line[column]
      tokens.push({
        startColumn: start,
        endColumn: column,
        type: next === '=' ? 'property' : logWordType(word),
      })
      continue
    }
    const start = column
    column = consumeLogValue(line, column)
    if (column > start) {
      tokens.push({ startColumn: start, endColumn: column, type: 'log-value' })
      continue
    }
    tokens.push({ startColumn: column, endColumn: column + 1, type: 'operator' })
    column++
  }
  return tokens
}

function consumeQuotedString(line: string, start: number, quote: string): number {
  let column = start + 1
  let escaped = false
  while (column < line.length) {
    const ch = line[column]!
    column++
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === quote) break
  }
  return column
}

function consumeJavaScriptNumber(line: string, start: number): number {
  let column = start
  while (column < line.length && /[0-9A-Fa-f_xXbBoOeE+\-.]/.test(line[column]!)) column++
  return column
}

function consumeIdentifier(line: string, start: number): number {
  let column = start
  while (column < line.length && /[$_\p{L}\p{N}]/u.test(line[column]!)) column++
  return column
}

function consumeShellWord(line: string, start: number): number {
  let column = start
  while (column < line.length && /[A-Za-z0-9_\-.]/.test(line[column]!)) column++
  return column
}

function consumeShellVariable(line: string, start: number): number {
  if (line[start + 1] === '{') {
    const close = line.indexOf('}', start + 2)
    return close >= 0 ? close + 1 : line.length
  }
  let column = start + 1
  while (column < line.length && /[A-Za-z0-9_]/.test(line[column]!)) column++
  return Math.max(start + 1, column)
}

function consumeLogNumberOrTimestamp(line: string, start: number): number {
  let column = start
  while (column < line.length && /[0-9T:.\-+/Z]/.test(line[column]!)) column++
  return column
}

function consumeLogWord(line: string, start: number): number {
  let column = start
  while (column < line.length && /[$_\p{L}\p{N}./:-]/u.test(line[column]!)) column++
  return column
}

function consumeLogValue(line: string, start: number): number {
  let column = start
  while (column < line.length && !isWhitespace(line[column]!)) {
    if (line[column] === '=' || line[column] === ',' || line[column] === ')' || line[column] === ']') break
    column++
  }
  return column
}

function logWordType(word: string): string {
  const upper = word.toUpperCase().replace(/^[\[(]+|[:\])]+$/g, '')
  if (upper === 'ERROR' || upper === 'FATAL') return 'log-error'
  if (upper === 'WARN' || upper === 'WARNING') return 'log-warn'
  if (upper === 'INFO') return 'log-info'
  if (upper === 'DEBUG' || upper === 'TRACE') return 'log-debug'
  return 'log-value'
}

function javascriptWordType(word: string): string {
  if (javascriptKeywords.has(word)) return 'keyword'
  if (word === 'true' || word === 'false' || word === 'null' || word === 'undefined') return 'keyword'
  return 'text'
}

function isIdentifierStart(ch: string): boolean {
  return /[$_\p{L}]/u.test(ch)
}

function isJavaScriptPunctuation(ch: string): boolean {
  return ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === '(' || ch === ')' || ch === ',' || ch === ';' || ch === ':' || ch === '.'
}

function isShellPunctuation(ch: string): boolean {
  return ch === '(' || ch === ')' || ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ';'
}
