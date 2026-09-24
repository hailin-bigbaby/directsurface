export interface DisableableRenderObject {
  disabled: boolean
}

export interface ReadOnlyRenderObject {
  readonly: boolean
}

export interface EditableRenderObject {
  editable: boolean
}

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

export function isDisableableRenderObject(value: unknown): value is DisableableRenderObject {
  return isObjectLike(value) && 'disabled' in value && typeof value.disabled === 'boolean'
}

export function isReadOnlyRenderObject(value: unknown): value is ReadOnlyRenderObject {
  return isObjectLike(value) && 'readonly' in value && typeof value.readonly === 'boolean'
}

export function isEditableRenderObject(value: unknown): value is EditableRenderObject {
  return isObjectLike(value) && 'editable' in value && typeof value.editable === 'boolean'
}

export function getRenderObjectEnabled(target: unknown): boolean | undefined {
  return isDisableableRenderObject(target) ? !target.disabled : undefined
}

export function setRenderObjectEnabled(target: unknown, enabled: boolean): boolean {
  if (!isDisableableRenderObject(target)) return false
  const disabled = !enabled
  if (target.disabled === disabled) return false
  target.disabled = disabled
  return true
}

export function setRenderObjectDisabled(target: unknown, disabled: boolean): boolean {
  if (!isDisableableRenderObject(target)) return false
  if (target.disabled === disabled) return false
  target.disabled = disabled
  return true
}

export function getRenderObjectReadOnly(target: unknown): boolean | undefined {
  return isReadOnlyRenderObject(target) ? target.readonly : undefined
}

export function setRenderObjectReadOnly(target: unknown, readOnly: boolean): boolean {
  if (!isReadOnlyRenderObject(target)) return false
  if (target.readonly === readOnly) return false
  target.readonly = readOnly
  return true
}

export function getRenderObjectEditable(target: unknown): boolean | undefined {
  return isEditableRenderObject(target) ? target.editable : undefined
}

export function setRenderObjectEditable(target: unknown, editable: boolean): boolean {
  if (!isEditableRenderObject(target)) return false
  if (target.editable === editable) return false
  target.editable = editable
  return true
}

export function setRenderObjectsEnabled(targets: Iterable<unknown>, enabled: boolean): number {
  let changed = 0
  for (const target of targets) {
    if (setRenderObjectEnabled(target, enabled)) changed++
  }
  return changed
}

export function setRenderObjectsReadOnly(targets: Iterable<unknown>, readOnly: boolean): number {
  let changed = 0
  for (const target of targets) {
    if (setRenderObjectReadOnly(target, readOnly)) changed++
  }
  return changed
}

export function setRenderObjectsEditable(targets: Iterable<unknown>, editable: boolean): number {
  let changed = 0
  for (const target of targets) {
    if (setRenderObjectEditable(target, editable)) changed++
  }
  return changed
}
