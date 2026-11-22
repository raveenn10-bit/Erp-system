import {describe,it,expect} from 'vitest';
import {dueDate,reminderDate,lineTotal,sumLines,invoiceTotals,normalizeWhatsApp,formatWhatsApp} from '../src/finance';

describe('financial calculations',()=>{
  it('uses integer minor units',()=>{
    expect(lineTotal(12525,3)).toBe(37575);
    expect(sumLines([{unitPriceCents:12525,quantity:3},{unitPriceCents:1,quantity:1}])).toBe(37576);
  });
  it('rejects unsafe values',()=>{
    expect(()=>lineTotal(1.3,2)).toThrow();
    expect(()=>lineTotal(Number.MAX_SAFE_INTEGER,2)).toThrow();
  });
  it('caps credit at 45 days and alerts 14 days before actual due date',()=>{
    expect(dueDate('2026-11-22',45)).toBe('2027-01-06');
    expect(reminderDate('2027-01-06')).toBe('2026-12-23');
    expect(()=>dueDate('2026-11-22',46)).toThrow();
  });
});

describe('discount calculations',()=>{
  it('combines item and invoice discounts without floating point money',()=>{
    expect(invoiceTotals([
      {unitPriceCents:10000,quantity:2,discount:{type:'percent',value:1000}},
      {unitPriceCents:5000,quantity:1,discount:{type:'fixed',value:500}},
    ],{type:'percent',value:500})).toEqual({subtotalCents:25000,itemDiscountCents:2500,invoiceDiscountCents:1125,totalDiscountCents:3625,totalCents:21375});
  });
  it('rejects discounts that would make a total negative',()=>{
    expect(()=>invoiceTotals([{unitPriceCents:1000,quantity:1,discount:{type:'fixed',value:1001}}])).toThrow();
  });
});

describe('WhatsApp number normalization & formatting',()=>{
  it('normalizes various Sri Lankan phone formats to 94XXXXXXXXX',()=>{
    expect(normalizeWhatsApp('077 123 4567')).toBe('94771234567');
    expect(normalizeWhatsApp('0771234567')).toBe('94771234567');
    expect(normalizeWhatsApp('771234567')).toBe('94771234567');
    expect(normalizeWhatsApp('+94771234567')).toBe('94771234567');
    expect(normalizeWhatsApp('94771234567')).toBe('94771234567');
    expect(normalizeWhatsApp('+94 76 661 5492')).toBe('94766615492');
  });
  it('formats normalized numbers nicely for display',()=>{
    expect(formatWhatsApp('0771234567')).toBe('+94 77 123 4567');
    expect(formatWhatsApp('+94766615492')).toBe('+94 76 661 5492');
  });
});
