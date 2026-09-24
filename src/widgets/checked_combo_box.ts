import {
  RenderMultiSelectDropdown,
  type RenderMultiSelectDropdownOptions,
} from './multi_select_dropdown'

export type RenderCheckedComboBoxOptions = Omit<RenderMultiSelectDropdownOptions, 'displayMode'>

/**
 * Compact multi-select editor that renders a single summary in the trigger.
 *
 * Selection, searching, keyboard navigation, and popup rendering stay owned by
 * RenderMultiSelectDropdown and MultiSelectDropdownPopup.
 */
export class RenderCheckedComboBox extends RenderMultiSelectDropdown {
  static override debugTypeName = 'RenderCheckedComboBox'

  constructor(options: RenderCheckedComboBoxOptions) {
    super({
      ...options,
      displayMode: 'summary',
    })
  }
}
