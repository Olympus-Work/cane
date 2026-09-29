import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Fill } from '../src/binance/trading.js';
import { futuresPnl, spotPnl } from '../src/engine/pnl.js';

interface FillInput {
  buy: boolean;
  qty: string;
  price: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl?: string | null;
}

function fill(p: FillInput): Fill {
  return {
    orderId: '1',
    time: 0,
    buy: p.buy,
    qty: new Decimal(p.qty),
    price: new Decimal(p.price),
    quoteQty: new Decimal(p.quoteQty),
    commission: new Decimal(p.commission),
    commissionAsset: p.commissionAsset,
    realizedPnl: p.realizedPnl === undefined || p.realizedPnl === null ? null : new Decimal(p.realizedPnl),
  };
}

describe('futuresPnl', () => {
  it('futures long: gross from Binance realised PnL, fees and funding', () => {
    const fills = [
      fill({ buy: true, qty: '0.002', price: '84000', quoteQty: '168', commission: '0.0672', commissionAsset: 'USDT', realizedPnl: '0' }),
      fill({ buy: false, qty: '0.002', price: '83000', quoteQty: '166', commission: '0.0664', commissionAsset: 'USDT', realizedPnl: '-2' }),
    ];
    const pnl = futuresPnl('long', fills, new Decimal('-0.05'));
    expect(pnl.qty.toString()).toBe('0.002');
    expect(pnl.entryPrice.toString()).toBe('84000');
    expect(pnl.exitPrice.toString()).toBe('83000');
    expect(pnl.grossPnl.toString()).toBe('-2');
    expect(pnl.fees.toString()).toBe('0.1336');
    expect(pnl.funding.toString()).toBe('-0.05');
    expect(pnl.netPnl.toString()).toBe('-2.1836');
  });

  it('futures short with received funding', () => {
    const fills = [
      fill({ buy: false, qty: '0.002', price: '84000', quoteQty: '168', commission: '0.0672', commissionAsset: 'USDT', realizedPnl: '0' }),
      fill({ buy: true, qty: '0.002', price: '83000', quoteQty: '166', commission: '0.0664', commissionAsset: 'USDT', realizedPnl: '2' }),
    ];
    const pnl = futuresPnl('short', fills, new Decimal('0.03'));
    expect(pnl.qty.toString()).toBe('0.002');
    expect(pnl.entryPrice.toString()).toBe('84000');
    expect(pnl.exitPrice.toString()).toBe('83000');
    expect(pnl.grossPnl.toString()).toBe('2');
    expect(pnl.fees.toString()).toBe('0.1336');
    expect(pnl.funding.toString()).toBe('0.03');
    expect(pnl.netPnl.toString()).toBe('1.8964');
  });

  it('futures: several fills average the prices; non-USDT fees are not counted', () => {
    const fills = [
      fill({ buy: true, qty: '0.001', price: '80000', quoteQty: '80', commission: '0.032', commissionAsset: 'USDT', realizedPnl: '0' }),
      fill({ buy: true, qty: '0.001', price: '82000', quoteQty: '82', commission: '0.0328', commissionAsset: 'USDT', realizedPnl: '0' }),
      fill({ buy: false, qty: '0.002', price: '83000', quoteQty: '166', commission: '0.0001', commissionAsset: 'BNB', realizedPnl: '4' }),
    ];
    const pnl = futuresPnl('long', fills, new Decimal('0'));
    expect(pnl.entryPrice.toString()).toBe('81000');
    expect(pnl.exitPrice.toString()).toBe('83000');
    expect(pnl.grossPnl.toString()).toBe('4');
    expect(pnl.fees.toString()).toBe('0.0648');
    expect(pnl.netPnl.toString()).toBe('3.9352');
  });
});

describe('spotPnl', () => {
  it('spot: base-asset entry fee is valued at its fill price', () => {
    const fills = [
      fill({ buy: true, qty: '0.0002', price: '84000', quoteQty: '16.8', commission: '0.0000002', commissionAsset: 'BTC' }),
      fill({ buy: false, qty: '0.00019', price: '85000', quoteQty: '16.15', commission: '0.01615', commissionAsset: 'USDT' }),
    ];
    const pnl = spotPnl('BTC', fills);
    expect(pnl.qty.toString()).toBe('0.00019');
    expect(pnl.entryPrice.toString()).toBe('84000');
    expect(pnl.exitPrice.toString()).toBe('85000');
    expect(pnl.grossPnl.toString()).toBe('0.19');
    expect(pnl.fees.toString()).toBe('0.03295');
    expect(pnl.funding.toString()).toBe('0');
    expect(pnl.netPnl.toString()).toBe('0.15705');
  });

  it('spot loss', () => {
    const fills = [
      fill({ buy: true, qty: '0.001', price: '60000', quoteQty: '60', commission: '0.000001', commissionAsset: 'BTC' }),
      fill({ buy: false, qty: '0.00099', price: '57000', quoteQty: '56.43', commission: '0.05643', commissionAsset: 'USDT' }),
    ];
    const pnl = spotPnl('BTC', fills);
    expect(pnl.entryPrice.toString()).toBe('60000');
    expect(pnl.exitPrice.toString()).toBe('57000');
    expect(pnl.qty.toString()).toBe('0.00099');
    expect(pnl.grossPnl.toString()).toBe('-2.97');
    expect(pnl.fees.toString()).toBe('0.11643');
    expect(pnl.netPnl.toString()).toBe('-3.08643');
  });
});

describe('empty fills', () => {
  it('no fills gives zeros', () => {
    const f = futuresPnl('long', [], new Decimal(0));
    expect(f.qty.toString()).toBe('0');
    expect(f.entryPrice.toString()).toBe('0');
    expect(f.exitPrice.toString()).toBe('0');
    expect(f.grossPnl.toString()).toBe('0');
    expect(f.fees.toString()).toBe('0');
    expect(f.funding.toString()).toBe('0');
    expect(f.netPnl.toString()).toBe('0');

    const s = spotPnl('BTC', []);
    expect(s.qty.toString()).toBe('0');
    expect(s.entryPrice.toString()).toBe('0');
    expect(s.exitPrice.toString()).toBe('0');
    expect(s.grossPnl.toString()).toBe('0');
    expect(s.fees.toString()).toBe('0');
    expect(s.funding.toString()).toBe('0');
    expect(s.netPnl.toString()).toBe('0');
  });
});
