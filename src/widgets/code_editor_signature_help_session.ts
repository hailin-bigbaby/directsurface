import type {
  CodeEditorSignatureHelp,
  CodeEditorSignatureHelpTriggerKind,
} from './code_editor'
import { normalizeRange, type TextPosition } from './plain_text_document'

export type CodeEditorSignatureHelpSessionState = 'closed' | 'pending' | 'active' | 'suppressed'

export interface CodeEditorSignatureHelpRequestHandle {
  requestSeq: number
  documentVersion: number
  languageContextVersion: number
  cursorGeneration: number
  position: TextPosition
  triggerKind: CodeEditorSignatureHelpTriggerKind
  triggerCharacter?: string
  isRetrigger: boolean
  signal: AbortSignal
}

export interface CodeEditorSignatureHelpSessionDebugState {
  state: CodeEditorSignatureHelpSessionState
  requestSeq: number
  documentVersion: number
  languageContextVersion: number
  cursorGeneration: number
  activeSignature: number | null
  activeParameter: number | null
  needsRetrigger: boolean
}

export class CodeEditorSignatureHelpSession {
  state: CodeEditorSignatureHelpSessionState = 'closed'
  requestSeq = 0
  documentVersion = 0
  languageContextVersion = 0
  cursorGeneration = 0
  lastTriggerPosition: TextPosition | null = null
  needsRetrigger = false

  private abortController?: AbortController
  private currentHelp: CodeEditorSignatureHelp | null = null
  private suppressCompletionCloseRetrigger = false

  get help(): CodeEditorSignatureHelp | null {
    return this.currentHelp ? cloneSignatureHelp(this.currentHelp) : null
  }

  get active(): boolean {
    return this.state !== 'closed'
  }

  get visible(): boolean {
    return this.state === 'active' && this.currentHelp !== null
  }

  beginRequest(options: {
    documentVersion: number
    languageContextVersion: number
    cursorGeneration: number
    position: TextPosition
    triggerKind: CodeEditorSignatureHelpTriggerKind
    triggerCharacter?: string
    isRetrigger: boolean
  }): CodeEditorSignatureHelpRequestHandle {
    this.abortController?.abort()
    this.abortController = new AbortController()
    this.requestSeq += 1
    this.documentVersion = options.documentVersion
    this.languageContextVersion = options.languageContextVersion
    this.cursorGeneration = options.cursorGeneration
    this.lastTriggerPosition = { ...options.position }
    this.currentHelp = null
    this.needsRetrigger = false
    this.state = 'pending'
    return {
      requestSeq: this.requestSeq,
      documentVersion: options.documentVersion,
      languageContextVersion: options.languageContextVersion,
      cursorGeneration: options.cursorGeneration,
      position: { ...options.position },
      triggerKind: options.triggerKind,
      triggerCharacter: options.triggerCharacter,
      isRetrigger: options.isRetrigger,
      signal: this.abortController.signal,
    }
  }

  isCurrent(
    handle: CodeEditorSignatureHelpRequestHandle,
    documentVersion: number,
    languageContextVersion: number,
    cursorGeneration: number,
  ): boolean {
    return !handle.signal.aborted &&
      handle.requestSeq === this.requestSeq &&
      handle.documentVersion === documentVersion &&
      handle.languageContextVersion === languageContextVersion &&
      handle.cursorGeneration === cursorGeneration
  }

  applyResult(
    handle: CodeEditorSignatureHelpRequestHandle,
    result: CodeEditorSignatureHelp | null,
    current: {
      documentVersion: number
      languageContextVersion: number
      cursorGeneration: number
    },
  ): boolean {
    if (!this.isCurrent(
      handle,
      current.documentVersion,
      current.languageContextVersion,
      current.cursorGeneration,
    )) return false
    if (this.abortController?.signal === handle.signal) this.abortController = undefined
    const normalized = result ? normalizeSignatureHelp(result) : null
    this.currentHelp = normalized
    this.state = normalized ? 'active' : 'closed'
    this.needsRetrigger = false
    return true
  }

  suppressForCompletion(): boolean {
    if (this.state !== 'pending' && this.state !== 'active') return false
    this.abortController?.abort()
    this.abortController = undefined
    this.requestSeq += 1
    this.currentHelp = null
    this.state = 'suppressed'
    this.needsRetrigger = true
    return true
  }

  markSuppressedChange(): void {
    if (this.state === 'suppressed') this.needsRetrigger = true
  }

  suppressNextCompletionCloseRetrigger(): void {
    this.suppressCompletionCloseRetrigger = true
  }

  consumeCompletionCloseRetrigger(): boolean {
    if (this.suppressCompletionCloseRetrigger) {
      this.suppressCompletionCloseRetrigger = false
      return false
    }
    if (this.state !== 'suppressed' || !this.needsRetrigger) return false
    this.needsRetrigger = false
    return true
  }

  moveActiveSignature(delta: number): boolean {
    if (!this.visible || !this.currentHelp || this.currentHelp.signatures.length <= 1) return false
    const count = this.currentHelp.signatures.length
    this.currentHelp.activeSignature = (this.currentHelp.activeSignature + delta + count) % count
    return true
  }

  close(): boolean {
    const changed = this.state !== 'closed' || this.currentHelp !== null || this.needsRetrigger
    this.abortController?.abort()
    this.abortController = undefined
    this.requestSeq += 1
    this.currentHelp = null
    this.lastTriggerPosition = null
    this.needsRetrigger = false
    this.suppressCompletionCloseRetrigger = false
    this.state = 'closed'
    return changed
  }

  debugState(): CodeEditorSignatureHelpSessionDebugState {
    return {
      state: this.state,
      requestSeq: this.requestSeq,
      documentVersion: this.documentVersion,
      languageContextVersion: this.languageContextVersion,
      cursorGeneration: this.cursorGeneration,
      activeSignature: this.currentHelp?.activeSignature ?? null,
      activeParameter: this.currentHelp?.activeParameter ?? null,
      needsRetrigger: this.needsRetrigger,
    }
  }
}

export function normalizeSignatureHelp(help: CodeEditorSignatureHelp): CodeEditorSignatureHelp | null {
  const original = help.signatures.map((signature, originalIndex) => ({
    originalIndex,
    signature: {
      label: String(signature.label),
      documentation: signature.documentation === undefined ? undefined : String(signature.documentation),
      parameters: signature.parameters.map(parameter => ({
        label: String(parameter.label),
        documentation: parameter.documentation === undefined ? undefined : String(parameter.documentation),
      })),
    },
  }))
  if (original.length === 0) return null
  const signatures = original.filter(entry => entry.signature.label.trim().length > 0)
  if (signatures.length === 0) return null

  const rawActive = Number.isFinite(help.activeSignature) ? Math.trunc(help.activeSignature) : 0
  const boundedActive = Math.max(0, Math.min(original.length - 1, rawActive))
  let activeSignature = signatures.findIndex(entry => entry.originalIndex === boundedActive)
  if (activeSignature < 0) {
    let bestDistance = Number.MAX_SAFE_INTEGER
    for (let index = 0; index < signatures.length; index += 1) {
      const distance = Math.abs(signatures[index]!.originalIndex - boundedActive)
      if (distance < bestDistance) {
        bestDistance = distance
        activeSignature = index
      }
    }
  }

  const rawParameter = Number.isFinite(help.activeParameter) ? Math.trunc(help.activeParameter) : 0
  return {
    signatures: signatures.map(entry => entry.signature),
    activeSignature,
    activeParameter: Math.max(0, rawParameter),
    range: help.range ? normalizeRange(help.range.start, help.range.end) : undefined,
  }
}

export function cloneSignatureHelp(help: CodeEditorSignatureHelp): CodeEditorSignatureHelp {
  return {
    signatures: help.signatures.map(signature => ({
      label: signature.label,
      documentation: signature.documentation,
      parameters: signature.parameters.map(parameter => ({
        label: parameter.label,
        documentation: parameter.documentation,
      })),
    })),
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
    range: help.range
      ? { start: { ...help.range.start }, end: { ...help.range.end } }
      : undefined,
  }
}
