import {
  runCleanupSteps,
  type DisposeFn,
} from '../../core/disposable'
import type {
  FormEditParticipant,
  FormSession,
  FormValidationParticipant,
} from '../../core/form_session'
import type { ValidationIssueInput } from '../../core/error_provider'
import type { ValidationTrigger } from '../../core/validation_provider'
import type { RenderDataGrid } from '../grid_view'
import type { DataGridEditSession } from './data_grid_edit_session'
import type { GridCellErrorState } from './grid_types'

export interface DataGridFormBindingOptions<
  TModel extends object,
  TRow extends Record<string, any>,
> {
  editSession: DataGridEditSession<TRow>
  source?: string
  field?: keyof TModel
  triggers?: readonly ValidationTrigger[]
  code?: string
  invalidMessage?: (
    errors: readonly GridCellErrorState<TRow>[],
  ) => string
}

let nextDataGridFormBindingId = 1

/**
 * Registers one DataGrid as a composite edit and validation participant of a
 * FormSession. The binding does not own the form, grid, or grid edit session.
 */
export function bindDataGridToForm<
  TModel extends object,
  TRow extends Record<string, any>,
>(
  form: FormSession<TModel>,
  grid: RenderDataGrid<TRow>,
  options: DataGridFormBindingOptions<TModel, TRow>,
): DisposeFn {
  const source = options.source
    ?? `data-grid-binding:${nextDataGridFormBindingId++}`
  const code = options.code ?? 'data-grid-invalid'
  const invalidMessage = options.invalidMessage
    ?? (errors => `表格中存在 ${errors.length} 个未通过校验的单元格`)
  let disposed = false

  const clearAggregateIssue = (): void => {
    if (disposed || form.disposed) return
    form.clearExternalIssues(source)
  }

  const setAggregateIssue = (
    errors: readonly GridCellErrorState<TRow>[],
  ): void => {
    if (disposed || form.disposed) return
    const issue: ValidationIssueInput<keyof TModel> = {
      code,
      message: invalidMessage(errors),
      severity: 'error',
      ...(
        options.field === undefined
          ? {}
          : { field: options.field }
      ),
    }
    form.setExternalIssues(source, [issue])
  }

  const editParticipant: FormEditParticipant<keyof TModel> = {
    get isDirty() {
      return options.editSession.isDirty
    },
    get isTouched() {
      return options.editSession.isTouched
    },
    flushPendingEdit: () => {
      if (disposed || options.editSession.disposed) return
      if (grid.commitEdit()) return
      setAggregateIssue(grid.getCellErrors())
    },
    cancelPendingEdit: () => {
      if (disposed) return
      grid.cancelEdit()
    },
    resetEdits: () => {
      if (disposed || options.editSession.disposed) return
      options.editSession.reset()
    },
    acceptEdits: () => {
      if (disposed || options.editSession.disposed) return
      if (!options.editSession.acceptChanges()) {
        throw new Error(
          'DataGrid edit session could not accept changes because the active cell is invalid.',
        )
      }
    },
    subscribeState: listener => options.editSession.subscribe(listener),
  }

  const validationParticipant: FormValidationParticipant = {
    triggers: options.triggers ?? ['submit'],
    validate: (_trigger, signal) => {
      if (disposed || options.editSession.disposed || signal.aborted) {
        return false
      }
      const result = grid.validate()
      if (signal.aborted) return false
      if (result.valid) clearAggregateIssue()
      else setAggregateIssue(result.errors)
      return result.valid
    },
    focusFirstError: () => !disposed && grid.focusFirstError(),
    clear: () => {
      if (disposed) return
      grid.clearCellErrors()
      clearAggregateIssue()
    },
  }

  let disposeEditParticipant: DisposeFn | undefined
  let disposeValidationParticipant: DisposeFn | undefined
  let disposeIssueReset: DisposeFn | undefined
  try {
    disposeEditParticipant = form.registerEditParticipant(editParticipant)
    disposeValidationParticipant =
      form.registerValidationParticipant(validationParticipant)
    disposeIssueReset = options.editSession.subscribe(clearAggregateIssue)
  } catch (error) {
    disposed = true
    try {
      runCleanupSteps([
        ...(
          disposeIssueReset
            ? [disposeIssueReset]
            : []
        ),
        ...(
          disposeValidationParticipant
            ? [disposeValidationParticipant]
            : []
        ),
        ...(
          disposeEditParticipant
            ? [disposeEditParticipant]
            : []
        ),
      ])
    } catch {
      // Preserve the registration failure.
    }
    throw error
  }

  return makeIdempotentDisposer(() => {
    runCleanupSteps([
      () => {
        if (!form.disposed) form.clearExternalIssues(source)
      },
      disposeIssueReset!,
      disposeValidationParticipant!,
      disposeEditParticipant!,
      () => {
        disposed = true
      },
    ])
  })
}

function makeIdempotentDisposer(dispose: DisposeFn): DisposeFn {
  let active = true
  return () => {
    if (!active) return
    active = false
    dispose()
  }
}
