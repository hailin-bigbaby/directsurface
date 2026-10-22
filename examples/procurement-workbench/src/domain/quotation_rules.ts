import type { OrderDraft, Quote, SeedData } from './model'

export function isAvailableQuote(quote: Quote, seed: SeedData): boolean {
  return quote.enabled && quote.validFrom <= seed.businessDate && quote.validTo >= seed.businessDate
    && seed.suppliers.some(s => s.id === quote.supplierId && s.enabled)
}
export function availableQuotes(seed: SeedData, itemId: string, draft?: OrderDraft): Quote[] {
  return seed.quotes.filter(q => q.itemId === itemId && isAvailableQuote(q, seed)
    && (!draft?.supplierId || q.supplierId === draft.supplierId)
    && (!draft?.conditionProfileId || q.conditionProfileId === draft.conditionProfileId))
}
