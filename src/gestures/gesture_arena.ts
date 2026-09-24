// GestureArena: 手势竞争仲裁
// 多个识别器竞争同一 pointer 序列，最终只有一个胜出

import {
  pointerKey,
  resolvePointerIdentity,
  type PointerIdentity,
  type PointerIdentitySource,
  type PointerKey,
  type PointerType,
} from './pointer_identity'

export type GestureDisposition = 'accepted' | 'rejected'

export interface GestureArenaMember {
  /**
   * Set for drag, pan, resize, or selection recognizers whose acceptance owns
   * the sequence and must suppress a later semantic pointer activation.
   */
  readonly preventsPointerActivationOnAccept?: boolean
  acceptGesture(pointerId: number, pointerType?: PointerType): void
  rejectGesture(pointerId: number, pointerType?: PointerType): void
}

export class GestureArenaEntry {
  constructor(
    private readonly _manager: GestureArenaManager,
    readonly identity: PointerIdentity,
    readonly member: GestureArenaMember,
    private _resolved = false,
  ) {}

  get pointerId(): number {
    return this.identity.pointerId
  }

  get pointerType(): PointerType {
    return this.identity.pointerType
  }

  resolve(disposition: GestureDisposition): void {
    if (this._resolved) return
    this._resolved = true
    this._manager.resolve(this.identity, this.member, disposition)
  }
}

export interface GestureArenaState {
  readonly identity: PointerIdentity
  members: GestureArenaMember[]
  isOpen: boolean
}

export class GestureArenaManager {
  private _arenas = new Map<PointerKey, GestureArenaState>()

  add(pointer: PointerIdentitySource, member: GestureArenaMember): GestureArenaEntry {
    const identity = resolvePointerIdentity(pointer)
    const key = pointerKey(identity)
    let arena = this._arenas.get(key)
    if (!arena) {
      arena = { identity, members: [], isOpen: true }
      this._arenas.set(key, arena)
    }
    if (!arena.isOpen) {
      rejectGestureMember(member, identity)
      return new GestureArenaEntry(this, identity, member, true)
    }
    if (arena.members.includes(member)) {
      return new GestureArenaEntry(this, identity, member)
    }
    arena.members.push(member)
    return new GestureArenaEntry(this, identity, member)
  }

  close(pointer: PointerIdentitySource): void {
    const key = pointerKey(pointer)
    const arena = this._arenas.get(key)
    if (!arena) return
    arena.isOpen = false
    if (arena.members.length === 0) {
      this._arenas.delete(key)
    }
  }

  resolve(
    pointer: PointerIdentitySource,
    member: GestureArenaMember,
    disposition: GestureDisposition,
  ): void {
    const key = pointerKey(pointer)
    const arena = this._arenas.get(key)
    if (!arena || !arena.members.includes(member)) return

    if (disposition === 'accepted') {
      this._resolveInFavorOf(key, arena, member)
      return
    }

    arena.members = arena.members.filter(m => m !== member)
    try {
      rejectGestureMember(member, arena.identity)
    } finally {
      if (
        arena.members.length === 0 &&
        this._arenas.get(key) === arena
      ) {
        this._arenas.delete(key)
      }
    }
  }

  sweep(pointer: PointerIdentitySource): void {
    const key = pointerKey(pointer)
    const arena = this._arenas.get(key)
    if (!arena) return
    this._arenas.delete(key)
    rejectGestureMembers(arena.members, arena.identity)
  }

  cancel(pointer: PointerIdentitySource): void {
    const key = pointerKey(pointer)
    const arena = this._arenas.get(key)
    if (!arena) return
    this._arenas.delete(key)
    rejectGestureMembers(arena.members, arena.identity)
  }

  clear(): void {
    let firstError: unknown
    for (const arena of [...this._arenas.values()]) {
      try {
        this.cancel(arena.identity)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  has(pointer: PointerIdentitySource): boolean {
    return this._arenas.has(pointerKey(pointer))
  }

  members(pointer: PointerIdentitySource): readonly GestureArenaMember[] {
    return [...(this._arenas.get(pointerKey(pointer))?.members ?? [])]
  }

  private _resolveInFavorOf(
    key: PointerKey,
    arena: GestureArenaState,
    winner: GestureArenaMember,
  ): void {
    this._arenas.delete(key)
    let firstError: unknown
    for (const member of arena.members) {
      if (member === winner) continue
      try {
        rejectGestureMember(member, arena.identity)
      } catch (error) {
        firstError ??= error
      }
    }
    try {
      acceptGestureMember(winner, arena.identity)
    } catch (error) {
      firstError ??= error
    }
    if (firstError !== undefined) throw firstError
  }
}

export function acceptGestureMember(
  member: GestureArenaMember,
  identity: PointerIdentity,
): void {
  if (identity.pointerType === 'mouse') member.acceptGesture(identity.pointerId)
  else member.acceptGesture(identity.pointerId, identity.pointerType)
}

export function rejectGestureMember(
  member: GestureArenaMember,
  identity: PointerIdentity,
): void {
  if (identity.pointerType === 'mouse') member.rejectGesture(identity.pointerId)
  else member.rejectGesture(identity.pointerId, identity.pointerType)
}

function rejectGestureMembers(
  members: readonly GestureArenaMember[],
  identity: PointerIdentity,
): void {
  let firstError: unknown
  for (const member of members) {
    try {
      rejectGestureMember(member, identity)
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}
