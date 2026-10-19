import type { TextInputPort } from './text_input_port'
import { WebTextInputPort } from './web_text_input_port'

export function resolveDefaultTextInputPort(): TextInputPort {
  return WebTextInputPort.instance
}
