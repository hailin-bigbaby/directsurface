export interface MaskTokenDefinition {
  readonly pattern: RegExp
  readonly required?: boolean
  readonly transform?: (character: string) => string
}

export type MaskTokenDefinitions = Readonly<Record<string, MaskTokenDefinition>>

export type MaskOverwriteMode = 'insert' | 'replace'

export interface MaskPatternBlockDefinition {
  readonly kind?: 'pattern'
  readonly mask: string
  readonly placeholderCharacter?: string
}

export interface MaskRangeBlockDefinition {
  readonly kind: 'range'
  readonly length: number
  readonly min: number
  readonly max: number
  readonly placeholderCharacter?: string
}

export interface MaskEnumBlockDefinition {
  readonly kind: 'enum'
  readonly values: readonly string[]
  readonly caseSensitive?: boolean
  readonly placeholderCharacter?: string
}

export type MaskBlockDefinition =
  | MaskPatternBlockDefinition
  | MaskRangeBlockDefinition
  | MaskEnumBlockDefinition

export type MaskBlockDefinitions = Readonly<Record<string, MaskBlockDefinition>>

export interface MaskBlockState {
  readonly raw: string
  readonly complete: boolean
  readonly valid: boolean
}

export interface MaskValue {
  readonly raw: string
  readonly display: string
  readonly complete: boolean
  readonly rawToDisplay: readonly number[]
  readonly displayToRaw: readonly number[]
  readonly blocks?: Readonly<Record<string, MaskBlockState>>
}

export interface MaskEditResult extends MaskValue {
  readonly selectionStart: number
  readonly selectionEnd: number
}

interface MaskSlot {
  readonly kind: 'slot'
  readonly symbol: string
  readonly definition: MaskTokenDefinition
  readonly blockName?: string
  readonly placeholderCharacter?: string
}

interface MaskLiteral {
  readonly kind: 'literal'
  readonly value: string
}

type MaskPart = MaskSlot | MaskLiteral

interface CompiledMaskBlock {
  readonly name: string
  readonly definition: MaskBlockDefinition
  readonly startSlot: number
  readonly endSlot: number
  readonly lastRequiredSlot: number
}

interface CompiledMask {
  readonly parts: readonly MaskPart[]
  readonly blocks: Readonly<Record<string, CompiledMaskBlock>>
}

interface FormattedMaskValue extends MaskValue {
  readonly characters: readonly string[]
  readonly slotToDisplay: readonly number[]
  readonly displayToSlot: readonly number[]
}

const DEFAULT_MASK_TOKENS: MaskTokenDefinitions = {
  '0': { pattern: /\d/u, required: true },
  '9': { pattern: /\d/u, required: false },
  L: { pattern: /\p{L}/u, required: true },
  '?': { pattern: /\p{L}/u, required: false },
  A: { pattern: /[\p{L}\p{N}]/u, required: true },
  a: { pattern: /[\p{L}\p{N}]/u, required: false },
}

const ENUM_SLOT_DEFINITION: MaskTokenDefinition = {
  pattern: /[\s\S]/u,
  required: true,
}

/**
 * Stateless formatter/editor for fixed-format text values.
 *
 * Mask tokens:
 * - `0`: required digit, `9`: optional digit
 * - `L`: required letter, `?`: optional letter
 * - `A`: required letter or digit, `a`: optional letter or digit
 * - `\`: escapes the next character
 * - `{name}`: expands a named block when `blocks` are configured
 */
export class MaskEngine {
  readonly mask: string
  readonly definitions: MaskTokenDefinitions
  readonly blockDefinitions?: MaskBlockDefinitions

  private readonly _parts: readonly MaskPart[]
  private readonly _slots: readonly MaskSlot[]
  private readonly _blocks: Readonly<Record<string, CompiledMaskBlock>>
  private readonly _lastRequiredSlotIndex: number

  constructor(mask: string, options?: {
    definitions?: MaskTokenDefinitions
    blocks?: MaskBlockDefinitions
  }) {
    if (!mask) throw new Error('MaskEngine requires a non-empty mask.')
    this.mask = mask
    this.definitions = {
      ...DEFAULT_MASK_TOKENS,
      ...options?.definitions,
    }
    this.blockDefinitions = options?.blocks
    const compiled = compileMask(mask, this.definitions, options?.blocks)
    this._parts = compiled.parts
    this._blocks = compiled.blocks
    this._slots = this._parts.filter((part): part is MaskSlot => part.kind === 'slot')
    if (this._slots.length === 0) {
      throw new Error('MaskEngine requires at least one editable token.')
    }
    this._lastRequiredSlotIndex = findLastRequiredSlotIndex(this._slots)
  }

  get capacity(): number {
    return this._slots.length
  }

  normalize(value: string): MaskValue {
    return toMaskValue(this._normalizeInternal(value))
  }

  formatRaw(raw: string): MaskValue {
    return toMaskValue(this._formatRawInternal(raw))
  }

  /** Returns the full visual mask guide. It never changes raw or display values. */
  guide(raw: string, promptCharacter = '_'): string {
    assertSingleCharacter(promptCharacter, 'promptCharacter')
    const formatted = this._formatRawInternal(raw)
    let result = ''
    let slotIndex = 0
    for (const part of this._parts) {
      if (part.kind === 'literal') {
        result += part.value
        continue
      }
      result += formatted.characters[slotIndex]
        ?? part.placeholderCharacter
        ?? promptCharacter
      slotIndex += 1
    }
    return result
  }

  normalizeDisplay(
    display: string,
    selectionStart = display.length,
    selectionEnd = selectionStart,
  ): MaskEditResult {
    const startRaw = this._extractCharacters(display.slice(0, clampIndex(selectionStart, display.length))).length
    const endRaw = this._extractCharacters(display.slice(0, clampIndex(selectionEnd, display.length))).length
    const formatted = this._normalizeInternal(display)
    return withSelection(
      toMaskValue(formatted),
      slotBoundaryToDisplay(formatted, startRaw),
      slotBoundaryToDisplay(formatted, endRaw),
    )
  }

  replace(
    display: string,
    selectionStart: number,
    selectionEnd: number,
    text: string,
    options?: { mode?: MaskOverwriteMode },
  ): MaskEditResult {
    const current = this._normalizeInternal(display)
    const displayStart = clampIndex(Math.min(selectionStart, selectionEnd), current.display.length)
    const displayEnd = clampIndex(Math.max(selectionStart, selectionEnd), current.display.length)
    const slotStart = current.displayToSlot[displayStart] ?? current.characters.length
    const slotEnd = current.displayToSlot[displayEnd] ?? current.characters.length
    const prefix = current.characters.slice(0, slotStart)
    const inserted = this._extractCharacters(text, slotStart, true, prefix)
    const overwriteEnd = slotStart === slotEnd && options?.mode === 'replace'
      ? Math.min(current.characters.length, slotStart + inserted.length)
      : slotEnd
    const nextCharacters = [
      ...prefix,
      ...inserted,
      ...current.characters.slice(overwriteEnd),
    ]
    const next = this._formatRawInternal(nextCharacters.join(''))
    const cursorSlot = Math.min(next.characters.length, slotStart + inserted.length)
    const cursor = slotBoundaryToDisplay(next, cursorSlot)
    return withSelection(toMaskValue(next), cursor, cursor)
  }

  delete(
    display: string,
    selectionStart: number,
    selectionEnd: number,
    direction: 'backward' | 'forward',
  ): MaskEditResult {
    const current = this._normalizeInternal(display)
    const displayStart = clampIndex(Math.min(selectionStart, selectionEnd), current.display.length)
    const displayEnd = clampIndex(Math.max(selectionStart, selectionEnd), current.display.length)
    let slotStart = current.displayToSlot[displayStart] ?? current.characters.length
    let slotEnd = current.displayToSlot[displayEnd] ?? current.characters.length

    // A non-empty selection that contains only fixed literals must not delete a neighbour.
    if (displayStart === displayEnd && slotStart === slotEnd) {
      if (direction === 'backward') slotStart = Math.max(0, slotStart - 1)
      else slotEnd = Math.min(current.characters.length, slotEnd + 1)
    }

    if (this._wouldCrossBlockBoundary(current.characters.length, slotStart, slotEnd)) {
      const cursor = slotBoundaryToDisplay(current, Math.min(slotStart, current.characters.length))
      return withSelection(toMaskValue(current), cursor, cursor)
    }

    const nextCharacters = [
      ...current.characters.slice(0, slotStart),
      ...current.characters.slice(slotEnd),
    ]
    const next = this._formatRawInternal(nextCharacters.join(''))
    const expectedLength = current.characters.length - Math.max(0, slotEnd - slotStart)
    const targetBelongsToBlock = this._slots[slotStart]?.blockName !== undefined
    if (targetBelongsToBlock && next.characters.length !== expectedLength) {
      const cursor = slotBoundaryToDisplay(current, Math.min(slotStart, current.characters.length))
      return withSelection(toMaskValue(current), cursor, cursor)
    }
    const cursor = slotBoundaryToDisplay(next, Math.min(slotStart, next.characters.length))
    return withSelection(toMaskValue(next), cursor, cursor)
  }

  private _wouldCrossBlockBoundary(
    characterCount: number,
    slotStart: number,
    slotEnd: number,
  ): boolean {
    if (slotEnd >= characterCount) return false
    const targetBlock = this._slots[slotStart]?.blockName
    for (let index = slotEnd; index < characterCount; index += 1) {
      if (this._slots[index]?.blockName !== targetBlock) return true
    }
    return false
  }

  private _normalizeInternal(value: string): FormattedMaskValue {
    return this._formatCharacters(this._extractCharacters(value))
  }

  private _formatRawInternal(raw: string): FormattedMaskValue {
    return this._formatCharacters(this._extractCharacters(raw, 0, false))
  }

  private _formatCharacters(characters: readonly string[]): FormattedMaskValue {
    const accepted = characters.slice(0, this.capacity)
    const raw = accepted.join('')
    let display = ''
    let rawIndex = 0
    let slotIndex = 0
    const rawToDisplay: number[] = Array.from({ length: raw.length + 1 }, () => 0)
    const displayToRaw: number[] = [0]
    const slotToDisplay: number[] = [0]
    const displayToSlot: number[] = [0]

    for (const part of this._parts) {
      if (part.kind === 'literal') {
        if (accepted.length === 0 || slotIndex > accepted.length) break
        display += part.value
        for (let codeUnit = 0; codeUnit < part.value.length; codeUnit += 1) {
          displayToRaw.push(rawIndex)
          displayToSlot.push(slotIndex)
        }
        rawToDisplay[rawIndex] = display.length
        slotToDisplay[slotIndex] = display.length
        continue
      }

      if (slotIndex >= accepted.length) break
      const character = accepted[slotIndex]!
      const displayStart = display.length
      display += character
      for (let codeUnit = 1; codeUnit <= character.length; codeUnit += 1) {
        displayToRaw.push(rawIndex + codeUnit)
        displayToSlot.push(codeUnit === character.length ? slotIndex + 1 : slotIndex)
        rawToDisplay[rawIndex + codeUnit] = displayStart + codeUnit
      }
      rawIndex += character.length
      slotIndex += 1
      slotToDisplay[slotIndex] = display.length
    }

    const blocks = this._blockStates(accepted)
    const requiredComplete = this._lastRequiredSlotIndex < 0 || accepted.length > this._lastRequiredSlotIndex
    return {
      raw,
      display,
      complete: requiredComplete && Object.values(blocks ?? {}).every(block => block.complete && block.valid),
      rawToDisplay,
      displayToRaw,
      blocks,
      characters: accepted,
      slotToDisplay,
      displayToSlot,
    }
  }

  private _extractCharacters(
    value: string,
    startSlot = 0,
    respectLiterals = true,
    initialCharacters: readonly string[] = [],
  ): string[] {
    const characters: string[] = [...initialCharacters]
    let slotIndex = clampIndex(startSlot, this._slots.length)
    let partIndex = slotIndex === 0 ? 0 : partIndexForSlot(this._parts, slotIndex)

    for (const character of value) {
      if (slotIndex >= this._slots.length) break

      let consumedLiteral = false
      if (respectLiterals) {
        while (partIndex < this._parts.length) {
          const part = this._parts[partIndex]
          if (!part || part.kind !== 'literal') break
          partIndex += 1
          if (character === part.value) {
            consumedLiteral = true
            break
          }
        }
      }
      if (consumedLiteral) continue

      const transformed = this._acceptCharacter(character, slotIndex, characters)
      if (transformed === undefined) continue
      characters.push(transformed)
      partIndex = partIndexAfterSlot(this._parts, slotIndex)
      slotIndex += 1
    }

    return characters.slice(initialCharacters.length)
  }

  private _acceptCharacter(
    character: string,
    slotIndex: number,
    accepted: readonly string[],
  ): string | undefined {
    const slot = this._slots[slotIndex]
    if (!slot || !accepts(slot.definition.pattern, character)) return undefined
    const transformed = slot.definition.transform?.(character) ?? character
    if (Array.from(transformed).length !== 1 || !accepts(slot.definition.pattern, transformed)) {
      return undefined
    }
    if (!slot.blockName) return transformed
    const block = this._blocks[slot.blockName]
    if (!block) return undefined
    const prefix = accepted.slice(block.startSlot, slotIndex).join('') + transformed
    return blockAcceptsPrefix(block.definition, prefix) ? transformed : undefined
  }

  private _blockStates(characters: readonly string[]): Readonly<Record<string, MaskBlockState>> | undefined {
    const entries = Object.values(this._blocks).map(block => {
      const raw = characters.slice(block.startSlot, Math.min(block.endSlot, characters.length)).join('')
      const state = blockState(block, raw)
      return [block.name, state] as const
    })
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
}

function compileMask(
  mask: string,
  definitions: MaskTokenDefinitions,
  blockDefinitions?: MaskBlockDefinitions,
): CompiledMask {
  if (!blockDefinitions || Object.keys(blockDefinitions).length === 0) {
    return { parts: parseClassicMask(mask, definitions), blocks: {} }
  }

  const parts: MaskPart[] = []
  const blocks: Record<string, CompiledMaskBlock> = {}
  const usedBlocks = new Set<string>()
  const characters = Array.from(mask)
  let escaped = false
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!
    if (escaped) {
      parts.push({ kind: 'literal', value: character })
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character !== '{') {
      const definition = definitions[character]
      parts.push(definition
        ? { kind: 'slot', symbol: character, definition }
        : { kind: 'literal', value: character })
      continue
    }

    const closeIndex = characters.indexOf('}', index + 1)
    if (closeIndex < 0) throw new Error('MaskEngine found an unclosed block reference.')
    const name = characters.slice(index + 1, closeIndex).join('')
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`MaskEngine block reference has an invalid name: ${name}.`)
    }
    const blockDefinition = blockDefinitions[name]
    if (!blockDefinition) throw new Error(`MaskEngine references an unknown block: ${name}.`)
    if (usedBlocks.has(name)) throw new Error(`MaskEngine block may only be referenced once: ${name}.`)
    usedBlocks.add(name)

    const startSlot = countSlots(parts)
    const blockParts = compileBlock(name, blockDefinition, definitions)
    parts.push(...blockParts)
    const blockSlots = blockParts.filter((part): part is MaskSlot => part.kind === 'slot')
    if (blockSlots.length === 0) {
      throw new Error(`MaskEngine block ${name} requires at least one editable token.`)
    }
    const endSlot = startSlot + blockSlots.length
    blocks[name] = {
      name,
      definition: blockDefinition,
      startSlot,
      endSlot,
      lastRequiredSlot: findLastRequiredSlotIndex(blockSlots),
    }
    index = closeIndex
  }
  if (escaped) parts.push({ kind: 'literal', value: '\\' })
  return { parts, blocks }
}

function compileBlock(
  name: string,
  definition: MaskBlockDefinition,
  definitions: MaskTokenDefinitions,
): MaskPart[] {
  assertOptionalPromptCharacter(definition.placeholderCharacter, `blocks.${name}.placeholderCharacter`)
  if (definition.kind === 'range') {
    assertBlockLength(definition.length, name)
    if (!Number.isSafeInteger(definition.min) || !Number.isSafeInteger(definition.max) ||
      definition.min < 0 || definition.max < definition.min ||
      definition.max > 10 ** definition.length - 1) {
      throw new Error(`MaskEngine range block ${name} requires 0 <= min <= max within its length.`)
    }
    return Array.from({ length: definition.length }, () => ({
      kind: 'slot' as const,
      symbol: '0',
      definition: DEFAULT_MASK_TOKENS['0']!,
      blockName: name,
      placeholderCharacter: definition.placeholderCharacter,
    }))
  }
  if (definition.kind === 'enum') {
    if (definition.values.length === 0) {
      throw new Error(`MaskEngine enum block ${name} requires at least one value.`)
    }
    const lengths = new Set(definition.values.map(value => Array.from(value).length))
    if (lengths.size !== 1 || lengths.has(0)) {
      throw new Error(`MaskEngine enum block ${name} requires non-empty values of equal length.`)
    }
    const length = lengths.values().next().value as number
    return Array.from({ length }, () => ({
      kind: 'slot' as const,
      symbol: '*',
      definition: ENUM_SLOT_DEFINITION,
      blockName: name,
      placeholderCharacter: definition.placeholderCharacter,
    }))
  }

  if (!definition.mask) throw new Error(`MaskEngine pattern block ${name} requires a non-empty mask.`)
  return parseClassicMask(definition.mask, definitions).map(part => part.kind === 'slot'
    ? {
        ...part,
        blockName: name,
        placeholderCharacter: definition.placeholderCharacter,
      }
    : part)
}

function parseClassicMask(mask: string, definitions: MaskTokenDefinitions): MaskPart[] {
  const parts: MaskPart[] = []
  let escaped = false
  for (const character of mask) {
    if (escaped) {
      parts.push({ kind: 'literal', value: character })
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    const definition = definitions[character]
    parts.push(definition
      ? { kind: 'slot', symbol: character, definition }
      : { kind: 'literal', value: character })
  }
  if (escaped) parts.push({ kind: 'literal', value: '\\' })
  return parts
}

function blockAcceptsPrefix(definition: MaskBlockDefinition, prefix: string): boolean {
  if (definition.kind === 'range') return rangeAcceptsPrefix(definition, prefix)
  if (definition.kind === 'enum') {
    const normalizedPrefix = definition.caseSensitive === false ? prefix.toLowerCase() : prefix
    return definition.values.some(value => {
      const candidate = definition.caseSensitive === false ? value.toLowerCase() : value
      return candidate.startsWith(normalizedPrefix)
    })
  }
  return true
}

function rangeAcceptsPrefix(definition: MaskRangeBlockDefinition, prefix: string): boolean {
  if (!/^\d*$/u.test(prefix) || prefix.length > definition.length) return false
  if (prefix.length === 0) return true
  const remaining = definition.length - prefix.length
  const scale = 10 ** remaining
  const lower = Number(prefix) * scale
  const upper = lower + scale - 1
  return upper >= definition.min && lower <= definition.max
}

function blockState(block: CompiledMaskBlock, raw: string): MaskBlockState {
  const definition = block.definition
  if (definition.kind === 'range') {
    const valid = rangeAcceptsPrefix(definition, raw)
    const complete = raw.length === definition.length && valid
    return { raw, complete, valid }
  }
  if (definition.kind === 'enum') {
    const valid = blockAcceptsPrefix(definition, raw)
    const normalizedRaw = definition.caseSensitive === false ? raw.toLowerCase() : raw
    const complete = definition.values.some(value => {
      const candidate = definition.caseSensitive === false ? value.toLowerCase() : value
      return candidate === normalizedRaw
    })
    return { raw, complete, valid }
  }
  const complete = block.lastRequiredSlot < 0 || Array.from(raw).length > block.lastRequiredSlot
  return { raw, complete, valid: true }
}

function assertBlockLength(length: number, name: string): void {
  if (!Number.isInteger(length) || length <= 0 || length > 15) {
    throw new Error(`MaskEngine block ${name} length must be an integer between 1 and 15.`)
  }
}

function assertOptionalPromptCharacter(value: string | undefined, label: string): void {
  if (value !== undefined) assertSingleCharacter(value, label)
}

function assertSingleCharacter(value: string, label: string): void {
  if (Array.from(value).length !== 1) {
    throw new Error(`MaskEngine ${label} must contain exactly one character.`)
  }
}

function countSlots(parts: readonly MaskPart[]): number {
  return parts.reduce((count, part) => count + (part.kind === 'slot' ? 1 : 0), 0)
}

function findLastRequiredSlotIndex(slots: readonly MaskSlot[]): number {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index]
    if (slot && slot.definition.required !== false) return index
  }
  return -1
}

function partIndexForSlot(parts: readonly MaskPart[], targetSlot: number): number {
  let slotIndex = 0
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part || part.kind !== 'slot') continue
    if (slotIndex === targetSlot) return index
    slotIndex += 1
  }
  return parts.length
}

function partIndexAfterSlot(parts: readonly MaskPart[], targetSlot: number): number {
  const slotPartIndex = partIndexForSlot(parts, targetSlot)
  return Math.min(parts.length, slotPartIndex + 1)
}

function accepts(pattern: RegExp, character: string): boolean {
  pattern.lastIndex = 0
  const accepted = pattern.test(character)
  pattern.lastIndex = 0
  return accepted
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.max(0, Math.min(length, Math.floor(index)))
}

function slotBoundaryToDisplay(value: FormattedMaskValue, slotIndex: number): number {
  const index = clampIndex(slotIndex, value.characters.length)
  return value.slotToDisplay[index] ?? value.display.length
}

function toMaskValue(value: FormattedMaskValue): MaskValue {
  return {
    raw: value.raw,
    display: value.display,
    complete: value.complete,
    rawToDisplay: value.rawToDisplay,
    displayToRaw: value.displayToRaw,
    blocks: value.blocks,
  }
}

function withSelection(value: MaskValue, selectionStart: number, selectionEnd: number): MaskEditResult {
  return {
    ...value,
    selectionStart,
    selectionEnd,
  }
}
