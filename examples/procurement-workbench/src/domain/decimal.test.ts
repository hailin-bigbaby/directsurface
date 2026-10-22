import { describe, expect, it } from 'vitest'
import { calculateAmounts, decimal, halfUp, money, quantityInBase, scaled } from './decimal'

describe('exact procurement values',()=>{
  it('calculates the agreed equipment example without floating point drift',()=>{
    expect(calculateAmounts('2','1130',1300)).toEqual({grossCents:'226000',netCents:'200000',taxCents:'26000'})
    expect(calculateAmounts('1','0.005',1300).grossCents).toBe('1')
    expect(halfUp(5n,10n)).toBe(1n)
    expect(money('226000')).toBe('2260.00')
  })
  it('converts boxes to base units and enforces item precision',()=>{
    expect(quantityInBase('6','5',0)).toBe('30')
    expect(quantityInBase('4','5',0)).toBe('20')
    expect(()=>quantityInBase('0.5','1',0)).toThrow()
    expect(()=>quantityInBase('0','5',0)).toThrow()
    expect(()=>quantityInBase('0.001','0.001',3)).toThrow()
  })
  it('rejects exponent notation, negatives, NaN and unbounded input',()=>{
    for(const n of ['1e3','-1','NaN','Infinity','1000001','1.23456']) expect(()=>scaled(n,4)).toThrow()
    expect(decimal(1000n,3)).toBe('1');expect(decimal(0n,3)).toBe('0');expect(decimal(-500n,3)).toBe('-0.5')
  })
})
