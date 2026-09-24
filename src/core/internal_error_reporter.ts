export function reportFrameworkInternalError(scope: string, error: unknown): void {
  try {
    console.error(`[ds-ui:${scope}] Internal callback failed.`, error)
  } catch {
    // Diagnostics must never interrupt the framework path they report.
  }
}
