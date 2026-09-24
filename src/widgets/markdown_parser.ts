export type MarkdownFlavor = 'commonmark' | 'gfm'

export interface MarkdownParseOptions {
  flavor?: MarkdownFlavor
}

export interface MarkdownDocument {
  type: 'document'
  flavor: MarkdownFlavor
  blocks: MarkdownBlock[]
  references: Record<string, MarkdownLinkReference>
}

export interface MarkdownLinkReference {
  label: string
  destination: string
  title?: string
}

export type MarkdownBlock =
  | MarkdownHeadingBlock
  | MarkdownParagraphBlock
  | MarkdownBlockquoteBlock
  | MarkdownListBlock
  | MarkdownCodeBlock
  | MarkdownThematicBreakBlock
  | MarkdownTableBlock
  | MarkdownHtmlBlock

export interface MarkdownHeadingBlock {
  type: 'heading'
  depth: number
  children: MarkdownInline[]
  raw: string
}

export interface MarkdownParagraphBlock {
  type: 'paragraph'
  children: MarkdownInline[]
  raw: string
}

export interface MarkdownBlockquoteBlock {
  type: 'blockquote'
  children: MarkdownBlock[]
}

export interface MarkdownListBlock {
  type: 'list'
  ordered: boolean
  start: number
  loose: boolean
  items: MarkdownListItem[]
}

export interface MarkdownListItem {
  checked?: boolean
  children: MarkdownBlock[]
}

export interface MarkdownCodeBlock {
  type: 'codeBlock'
  language?: string
  meta?: string
  text: string
  copyText?: string
}

export interface MarkdownThematicBreakBlock {
  type: 'thematicBreak'
}

export type MarkdownTableAlignment = 'left' | 'center' | 'right' | 'none'

export interface MarkdownTableBlock {
  type: 'table'
  alignments: MarkdownTableAlignment[]
  header: MarkdownInline[][]
  rows: MarkdownInline[][][]
}

export interface MarkdownHtmlBlock {
  type: 'html'
  text: string
}

export type MarkdownInline =
  | MarkdownTextInline
  | MarkdownSoftBreakInline
  | MarkdownHardBreakInline
  | MarkdownCodeInline
  | MarkdownEmphasisInline
  | MarkdownStrongInline
  | MarkdownDeleteInline
  | MarkdownLinkInline
  | MarkdownImageInline
  | MarkdownHtmlInline

export interface MarkdownTextInline {
  type: 'text'
  text: string
}

export interface MarkdownSoftBreakInline {
  type: 'softBreak'
}

export interface MarkdownHardBreakInline {
  type: 'hardBreak'
}

export interface MarkdownCodeInline {
  type: 'code'
  text: string
}

export interface MarkdownEmphasisInline {
  type: 'emphasis'
  children: MarkdownInline[]
}

export interface MarkdownStrongInline {
  type: 'strong'
  children: MarkdownInline[]
}

export interface MarkdownDeleteInline {
  type: 'delete'
  children: MarkdownInline[]
}

export interface MarkdownLinkInline {
  type: 'link'
  href: string
  title?: string
  children: MarkdownInline[]
}

export interface MarkdownImageInline {
  type: 'image'
  src: string
  title?: string
  alt: string
}

export interface MarkdownHtmlInline {
  type: 'html'
  text: string
}

interface ParseContext {
  flavor: MarkdownFlavor
  references: Record<string, MarkdownLinkReference>
}

export function parseMarkdown(markdown: string, options: MarkdownParseOptions = {}): MarkdownDocument {
  const flavor = options.flavor ?? 'gfm'
  const references: Record<string, MarkdownLinkReference> = {}
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  for (const line of lines) {
    const reference = parseReferenceDefinition(line)
    if (reference) references[reference.label.toLowerCase()] = reference
  }
  const context: ParseContext = { flavor, references }
  return {
    type: 'document',
    flavor,
    blocks: parseBlocks(lines, context),
    references,
  }
}

export function markdownDocumentToPlainText(document: MarkdownDocument): string {
  return markdownBlocksToPlainText(document.blocks)
}

export function markdownBlocksToPlainText(blocks: readonly MarkdownBlock[]): string {
  return blocks
    .map(block => markdownBlockToPlainText(block))
    .filter(text => text.length > 0)
    .join('\n\n')
}

export function markdownBlockToPlainText(block: MarkdownBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return markdownInlinesToPlainText(block.children).trim()
    case 'blockquote':
      return markdownBlocksToPlainText(block.children)
        .split('\n')
        .map(line => line ? `> ${line}` : '>')
        .join('\n')
    case 'list':
      return block.items.map((item, index) => {
        const marker = block.ordered ? `${block.start + index}.` : '-'
        const task = item.checked === undefined ? '' : item.checked ? ' [x]' : ' [ ]'
        const text = markdownBlocksToPlainText(item.children)
        return `${marker}${task} ${indentPlainTextContinuation(text)}`
      }).join('\n')
    case 'codeBlock':
      return block.text
    case 'thematicBreak':
      return '---'
    case 'table':
      return [
        block.header.map(cell => markdownInlinesToPlainText(cell)).join('\t'),
        ...block.rows.map(row => row.map(cell => markdownInlinesToPlainText(cell)).join('\t')),
      ].join('\n')
    case 'html':
      return block.text
  }
}

export function markdownInlinesToPlainText(inlines: readonly MarkdownInline[]): string {
  let text = ''
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
      case 'code':
      case 'html':
        text += inline.text
        break
      case 'softBreak':
        text += ' '
        break
      case 'hardBreak':
        text += '\n'
        break
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'link':
        text += markdownInlinesToPlainText(inline.children)
        break
      case 'image':
        text += inline.alt || inline.title || inline.src
        break
    }
  }
  return text
}

function parseBlocks(lines: string[], context: ParseContext): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line)) {
      index++
      continue
    }

    const reference = parseReferenceDefinition(line)
    if (reference) {
      context.references[reference.label.toLowerCase()] = reference
      index++
      continue
    }

    const fence = parseFenceStart(line)
    if (fence) {
      const result = collectFence(lines, index, fence)
      blocks.push(result.block)
      index = result.nextIndex
      continue
    }

    const heading = parseHeading(line, context)
    if (heading) {
      blocks.push(heading)
      index++
      continue
    }

    if (isThematicBreak(line)) {
      blocks.push({ type: 'thematicBreak' })
      index++
      continue
    }

    if (isHtmlBlockLine(line)) {
      blocks.push({ type: 'html', text: line.trim() })
      index++
      continue
    }

    if (isBlockquoteLine(line)) {
      const result = collectBlockquote(lines, index, context)
      blocks.push(result.block)
      index = result.nextIndex
      continue
    }

    if (parseListMarker(line)) {
      const result = collectList(lines, index, context)
      blocks.push(result.block)
      index = result.nextIndex
      continue
    }

    const table = context.flavor === 'gfm' ? parseTable(lines, index, context) : null
    if (table) {
      blocks.push(table.block)
      index = table.nextIndex
      continue
    }

    const paragraph = collectParagraph(lines, index, context)
    blocks.push(paragraph.block)
    index = paragraph.nextIndex
  }

  return blocks
}

function parseHeading(line: string, context: ParseContext): MarkdownHeadingBlock | null {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line)
  if (!match) return null
  const depth = match[2]!.length
  const raw = (match[3] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim()
  return {
    type: 'heading',
    depth,
    raw,
    children: parseInlines(raw, context),
  }
}

function parseFenceStart(line: string): { marker: string; length: number; info: string } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const marker = match[2]![0]!
  return {
    marker,
    length: match[2]!.length,
    info: (match[3] ?? '').trim(),
  }
}

function collectFence(
  lines: string[],
  startIndex: number,
  fence: { marker: string; length: number; info: string },
): { block: MarkdownCodeBlock; nextIndex: number } {
  const body: string[] = []
  let index = startIndex + 1
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const closeMatch = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}[ \\t]*$`).exec(line)
    if (closeMatch) {
      index++
      break
    }
    body.push(line)
    index++
  }
  const [language, ...meta] = fence.info.split(/\s+/).filter(Boolean)
  return {
    block: {
      type: 'codeBlock',
      language,
      meta: meta.length > 0 ? meta.join(' ') : undefined,
      text: body.join('\n'),
    },
    nextIndex: index,
  }
}

function collectBlockquote(
  lines: string[],
  startIndex: number,
  context: ParseContext,
): { block: MarkdownBlockquoteBlock; nextIndex: number } {
  const quoteLines: string[] = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line)) {
      quoteLines.push('')
      index++
      continue
    }
    if (!isBlockquoteLine(line)) break
    quoteLines.push(line.replace(/^ {0,3}> ?/, ''))
    index++
  }
  return {
    block: {
      type: 'blockquote',
      children: parseBlocks(quoteLines, context),
    },
    nextIndex: index,
  }
}

interface ListMarker {
  indent: number
  ordered: boolean
  start: number
  marker: string
  task?: boolean
  checked?: boolean
  text: string
}

function parseListMarker(line: string): ListMarker | null {
  const match = /^(\s{0,})([-+*]|\d+[.)])\s+(.*)$/.exec(line)
  if (!match) return null
  const indent = countSpaces(match[1]!)
  if (indent > 3) return null
  let text = match[3] ?? ''
  let task: boolean | undefined
  let checked: boolean | undefined
  const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(text)
  if (taskMatch) {
    task = true
    checked = taskMatch[1]!.toLowerCase() === 'x'
    text = taskMatch[2] ?? ''
  }
  const marker = match[2]!
  const ordered = /^\d/.test(marker)
  return {
    indent,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    marker,
    task,
    checked,
    text,
  }
}

function collectList(
  lines: string[],
  startIndex: number,
  context: ParseContext,
): { block: MarkdownListBlock; nextIndex: number } {
  const first = parseListMarker(lines[startIndex] ?? '')!
  const items: MarkdownListItem[] = []
  let index = startIndex
  let loose = false

  while (index < lines.length) {
    const marker = parseListMarker(lines[index] ?? '')
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break

    const itemLines: string[] = [marker.text]
    index++
    let sawBlank = false
    while (index < lines.length) {
      const line = lines[index] ?? ''
      const nextMarker = parseListMarker(line)
      if (nextMarker && nextMarker.indent === first.indent && nextMarker.ordered === first.ordered) break
      if (isBlank(line)) {
        sawBlank = true
        itemLines.push('')
        index++
        continue
      }
      const stripped = stripContinuationIndent(line, first.indent + 2)
      if (stripped === null) break
      itemLines.push(stripped)
      index++
    }
    if (sawBlank) loose = true
    items.push({
      checked: marker.task ? marker.checked : undefined,
      children: parseBlocks(trimOuterBlankLines(itemLines), context),
    })
  }

  return {
    block: {
      type: 'list',
      ordered: first.ordered,
      start: first.start,
      loose,
      items,
    },
    nextIndex: index,
  }
}

function stripContinuationIndent(line: string, indent: number): string | null {
  const spaces = countSpaces(line.match(/^\s*/)?.[0] ?? '')
  if (spaces >= indent) return line.slice(indent)
  if (spaces > 0) return line.slice(spaces)
  return null
}

function parseTable(
  lines: string[],
  startIndex: number,
  context: ParseContext,
): { block: MarkdownTableBlock; nextIndex: number } | null {
  const headerLine = lines[startIndex] ?? ''
  const delimiterLine = lines[startIndex + 1] ?? ''
  if (!headerLine.includes('|') || !isTableDelimiter(delimiterLine)) return null
  const headerCells = splitTableRow(headerLine)
  const alignments = splitTableRow(delimiterLine).map(parseTableAlignment)
  if (headerCells.length < alignments.length) {
    while (headerCells.length < alignments.length) headerCells.push('')
  }
  const rows: MarkdownInline[][][] = []
  let index = startIndex + 2
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line) || !line.includes('|')) break
    const rawCells = splitTableRow(line).slice(0, alignments.length)
    while (rawCells.length < alignments.length) rawCells.push('')
    rows.push(rawCells.map(cell => parseInlines(cell.trim(), context)))
    index++
  }
  return {
    block: {
      type: 'table',
      alignments,
      header: headerCells.slice(0, alignments.length).map(cell => parseInlines(cell.trim(), context)),
      rows,
    },
    nextIndex: index,
  }
}

function collectParagraph(
  lines: string[],
  startIndex: number,
  context: ParseContext,
): { block: MarkdownParagraphBlock; nextIndex: number } {
  const paragraphLines: string[] = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line)) break
    if (paragraphLines.length > 0) {
      if (parseFenceStart(line) || parseHeading(line, context) || isThematicBreak(line) || isBlockquoteLine(line) || parseListMarker(line)) break
      if (context.flavor === 'gfm' && parseTable(lines, index, context)) break
    }
    paragraphLines.push(line.trim())
    index++
  }
  const raw = paragraphLines.join('\n')
  return {
    block: {
      type: 'paragraph',
      raw,
      children: parseInlines(raw, context),
    },
    nextIndex: index,
  }
}

export function parseInlines(text: string, contextOrOptions: ParseContext | MarkdownParseOptions = {}): MarkdownInline[] {
  const context = 'references' in contextOrOptions
    ? contextOrOptions
    : { flavor: contextOrOptions.flavor ?? 'gfm', references: {} }
  return mergeTextNodes(parseInlineRange(text, context))
}

function parseInlineRange(text: string, context: ParseContext): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let buffer = ''
  let index = 0

  const flush = () => {
    if (!buffer) return
    nodes.push({ type: 'text', text: buffer })
    buffer = ''
  }

  while (index < text.length) {
    const char = text[index]!
    const next = text[index + 1]

    if (char === '\\') {
      if (next === '\n') {
        flush()
        nodes.push({ type: 'hardBreak' })
        index += 2
        continue
      }
      if (next && /[\\`*{}\[\]()#+\-.!_|>~]/.test(next)) {
        buffer += next
        index += 2
        continue
      }
    }

    if (char === '\n') {
      const hard = buffer.endsWith('  ')
      if (hard) buffer = buffer.slice(0, -2)
      flush()
      nodes.push({ type: hard ? 'hardBreak' : 'softBreak' })
      index++
      continue
    }

    if (char === '`') {
      const close = text.indexOf('`', index + 1)
      if (close > index) {
        flush()
        nodes.push({ type: 'code', text: text.slice(index + 1, close).replace(/\s+/g, ' ') })
        index = close + 1
        continue
      }
    }

    if (char === '!' && next === '[') {
      const image = parseInlineLinkLike(text, index + 1, context)
      if (image) {
        flush()
        nodes.push({
          type: 'image',
          src: image.href,
          title: image.title,
          alt: plainText(image.children),
        })
        index = image.nextIndex
        continue
      }
    }

    if (char === '[') {
      const link = parseInlineLinkLike(text, index, context)
      if (link) {
        flush()
        nodes.push({
          type: 'link',
          href: link.href,
          title: link.title,
          children: link.children,
        })
        index = link.nextIndex
        continue
      }
    }

    if (char === '<') {
      const autolink = parseAutolink(text, index)
      if (autolink) {
        flush()
        nodes.push({
          type: 'link',
          href: autolink.href,
          children: [{ type: 'text', text: autolink.label }],
        })
        index = autolink.nextIndex
        continue
      }
      const close = text.indexOf('>', index + 1)
      if (close > index) {
        flush()
        nodes.push({ type: 'html', text: text.slice(index, close + 1) })
        index = close + 1
        continue
      }
    }

    if (context.flavor === 'gfm' && char === '~' && next === '~') {
      const close = text.indexOf('~~', index + 2)
      if (close > index + 2) {
        flush()
        nodes.push({ type: 'delete', children: parseInlineRange(text.slice(index + 2, close), context) })
        index = close + 2
        continue
      }
    }

    if ((char === '*' || char === '_') && next === char) {
      const marker = char + char
      const close = text.indexOf(marker, index + 2)
      if (close > index + 2) {
        flush()
        nodes.push({ type: 'strong', children: parseInlineRange(text.slice(index + 2, close), context) })
        index = close + 2
        continue
      }
    }

    if (char === '*' || char === '_') {
      const close = text.indexOf(char, index + 1)
      if (close > index + 1) {
        flush()
        nodes.push({ type: 'emphasis', children: parseInlineRange(text.slice(index + 1, close), context) })
        index = close + 1
        continue
      }
    }

    buffer += char
    index++
  }

  flush()
  return nodes
}

function parseInlineLinkLike(
  text: string,
  startIndex: number,
  context: ParseContext,
): { href: string; title?: string; children: MarkdownInline[]; nextIndex: number } | null {
  const labelEnd = findClosingBracket(text, startIndex)
  if (labelEnd < 0) return null
  const label = text.slice(startIndex + 1, labelEnd)
  if (text[labelEnd + 1] === '(') {
    const close = text.indexOf(')', labelEnd + 2)
    if (close > labelEnd + 2) {
      const destination = parseLinkDestination(text.slice(labelEnd + 2, close).trim())
      if (!destination.href) return null
      return {
        href: destination.href,
        title: destination.title,
        children: parseInlineRange(label, context),
        nextIndex: close + 1,
      }
    }
  }
  if (text[labelEnd + 1] === '[') {
    const refEnd = text.indexOf(']', labelEnd + 2)
    if (refEnd > labelEnd + 1) {
      const refLabel = text.slice(labelEnd + 2, refEnd) || label
      const reference = context.references[refLabel.toLowerCase()]
      if (reference) {
        return {
          href: reference.destination,
          title: reference.title,
          children: parseInlineRange(label, context),
          nextIndex: refEnd + 1,
        }
      }
    }
  }
  return null
}

function parseAutolink(text: string, startIndex: number): { href: string; label: string; nextIndex: number } | null {
  const close = text.indexOf('>', startIndex + 1)
  if (close <= startIndex + 1) return null
  const body = text.slice(startIndex + 1, close)
  if (/^[a-z][a-z0-9+.-]{1,31}:[^\s<>]*$/i.test(body)) {
    return { href: body, label: body, nextIndex: close + 1 }
  }
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body)) {
    return { href: `mailto:${body}`, label: body, nextIndex: close + 1 }
  }
  return null
}

function parseLinkDestination(raw: string): { href: string; title?: string } {
  if (!raw) return { href: '' }
  const quoted = /^(\S+)\s+["']([^"']*)["']$/.exec(raw)
  if (quoted) return { href: trimAngleDestination(quoted[1]!), title: quoted[2] }
  return { href: trimAngleDestination(raw) }
}

function trimAngleDestination(value: string): string {
  if (value.startsWith('<') && value.endsWith('>')) return value.slice(1, -1)
  return value
}

function findClosingBracket(text: string, startIndex: number): number {
  let depth = 0
  for (let index = startIndex; index < text.length; index++) {
    const char = text[index]
    if (char === '\\') {
      index++
      continue
    }
    if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

function plainText(nodes: MarkdownInline[]): string {
  let text = ''
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code' || node.type === 'html') text += node.text
    else if ('children' in node) text += plainText(node.children)
  }
  return text
}

function mergeTextNodes(nodes: MarkdownInline[]): MarkdownInline[] {
  const merged: MarkdownInline[] = []
  for (const node of nodes) {
    const previous = merged[merged.length - 1]
    if (node.type === 'text' && previous?.type === 'text') {
      previous.text += node.text
    } else {
      merged.push(node)
    }
  }
  return merged
}

function parseReferenceDefinition(line: string): MarkdownLinkReference | null {
  const match = /^ {0,3}\[([^\]]+)\]:\s+(\S+)(?:\s+["']([^"']+)["'])?\s*$/.exec(line)
  if (!match) return null
  return {
    label: match[1]!,
    destination: trimAngleDestination(match[2]!),
    title: match[3],
  }
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line)
  if (cells.length === 0) return false
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function parseTableAlignment(value: string): MarkdownTableAlignment {
  const trimmed = value.trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return 'none'
}

function splitTableRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function isBlockquoteLine(line: string): boolean {
  return /^ {0,3}>/.test(line)
}

function isHtmlBlockLine(line: string): boolean {
  return /^ {0,3}<\/?[A-Za-z][^>]*>.*$/.test(line)
}

function isThematicBreak(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 3) return false
  return /^(\*\s*){3,}$/.test(trimmed) ||
    /^(-\s*){3,}$/.test(trimmed) ||
    /^(_\s*){3,}$/.test(trimmed)
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line)
}

function countSpaces(value: string): number {
  let count = 0
  for (const char of value) count += char === '\t' ? 4 : 1
  return count
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && isBlank(lines[start] ?? '')) start++
  while (end > start && isBlank(lines[end - 1] ?? '')) end--
  return lines.slice(start, end)
}

function indentPlainTextContinuation(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line, index) => index === 0 ? line : `  ${line}`)
    .join('\n')
}
