import type { PropertyGridEditorKind, PropertyGridEnumItem, PropertyGridRow } from './property_grid'

export type PropertyGridFieldValue<TContext, TValue> =
  | TValue
  | ((context: TContext) => TValue)

export interface PropertyGridField<TContext> {
  readonly id?: PropertyGridFieldValue<TContext, string | undefined>
  readonly group: PropertyGridFieldValue<TContext, string>
  readonly name: PropertyGridFieldValue<TContext, string>
  readonly label?: PropertyGridFieldValue<TContext, string | undefined>
  readonly propPath?: PropertyGridFieldValue<TContext, string | undefined>
  readonly value: PropertyGridFieldValue<TContext, unknown>
  readonly format?: (value: unknown, context: TContext) => string
  readonly kind?: PropertyGridFieldValue<TContext, PropertyGridEditorKind | undefined>
  readonly editor?: PropertyGridFieldValue<TContext, PropertyGridEditorKind | undefined>
  readonly editable?: PropertyGridFieldValue<TContext, boolean | undefined>
  readonly description?: PropertyGridFieldValue<TContext, string | undefined>
  readonly status?: PropertyGridFieldValue<TContext, PropertyGridRow['status'] | undefined>
  readonly errorText?: PropertyGridFieldValue<TContext, string | undefined>
  readonly enumItems?: PropertyGridFieldValue<TContext, readonly PropertyGridEnumItem[] | undefined>
  readonly unit?: PropertyGridFieldValue<TContext, string | undefined>
  readonly step?: PropertyGridFieldValue<TContext, number | undefined>
  readonly min?: PropertyGridFieldValue<TContext, number | undefined>
  readonly max?: PropertyGridFieldValue<TContext, number | undefined>
  readonly decimals?: PropertyGridFieldValue<TContext, number | undefined>
  readonly clearable?: PropertyGridFieldValue<TContext, boolean | undefined>
  readonly visibleWhen?: (context: TContext) => boolean
}

export type PropertyGridSchema<TContext> = readonly PropertyGridField<TContext>[]

export function definePropertyGridSchema<TContext>(schema: PropertyGridSchema<TContext>): PropertyGridSchema<TContext> {
  return schema
}

export function buildPropertyGridRows<TContext>(
  context: TContext,
  schema: PropertyGridSchema<TContext>,
): PropertyGridRow[] {
  const rows: PropertyGridRow[] = []
  for (const field of schema) {
    if (field.visibleWhen && !field.visibleWhen(context)) continue
    const value = resolvePropertyGridFieldValue(field.value, context)
    const group = resolvePropertyGridFieldValue(field.group, context)
    const name = resolvePropertyGridFieldValue(field.name, context)
    if (group === undefined || name === undefined) continue
    rows.push({
      id: resolvePropertyGridFieldValue(field.id, context),
      group,
      name,
      label: resolvePropertyGridFieldValue(field.label, context),
      propPath: resolvePropertyGridFieldValue(field.propPath, context),
      value: field.format ? field.format(value, context) : formatPropertyGridSchemaValue(value),
      kind: resolvePropertyGridFieldValue(field.kind, context),
      editor: resolvePropertyGridFieldValue(field.editor, context),
      editable: resolvePropertyGridFieldValue(field.editable, context),
      description: resolvePropertyGridFieldValue(field.description, context),
      status: resolvePropertyGridFieldValue(field.status, context),
      errorText: resolvePropertyGridFieldValue(field.errorText, context),
      enumItems: resolvePropertyGridFieldValue(field.enumItems, context),
      unit: resolvePropertyGridFieldValue(field.unit, context),
      step: resolvePropertyGridFieldValue(field.step, context),
      min: resolvePropertyGridFieldValue(field.min, context),
      max: resolvePropertyGridFieldValue(field.max, context),
      decimals: resolvePropertyGridFieldValue(field.decimals, context),
      clearable: resolvePropertyGridFieldValue(field.clearable, context),
    })
  }
  return rows
}

function resolvePropertyGridFieldValue<TContext, TValue>(
  value: PropertyGridFieldValue<TContext, TValue> | undefined,
  context: TContext,
): TValue | undefined {
  return typeof value === 'function'
    ? (value as (context: TContext) => TValue)(context)
    : value
}

function formatPropertyGridSchemaValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
