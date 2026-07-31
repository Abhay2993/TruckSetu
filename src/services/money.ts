/**
 * TruckSetu Money — pricing math, shared by demo mode and the UI.
 *
 * These numbers mirror server/src/money.ts exactly so a quote shown in the
 * app equals the quote the server books. When commercial terms change, both
 * files change together — they are the same contract on two sides of the
 * wire.
 */

import type { EscrowShipment } from '../types';

export const MONEY = {
  DISCOUNT_FEE_RATE_PER_30D: 0.0125,
  CREDIT_LINE_APR: 0.18,
  EMI_APR: 0.2,
  FUEL_DISCOUNT_INR_PER_LITRE: 1.5,
  FUEL_CASHBACK_RATE: 0.005,
  CREDIT_SWEEP_RATE: 0.25,
  GST_RATE: 0.05,
} as const;

export const EMI_CATALOGUE = [
  { id: 'tyre', label: 'Truck tyre set (6)', priceInr: 96000 },
  { id: 'repair', label: 'Engine repair / overhaul', priceInr: 45000 },
  { id: 'battery', label: 'Heavy-duty battery', priceInr: 18000 },
] as const;

export const EMI_TENORS = [3, 6, 9, 12] as const;

export const PARTNER_PUMPS = [
  { name: 'Behror Highway Fuels', city: 'Behror', dieselInrPerLitre: 89.6 },
  { name: 'Shahjahanpur Truck Stop', city: 'Shahjahanpur', dieselInrPerLitre: 90.2 },
  { name: 'Manesar Fleet Point', city: 'Manesar', dieselInrPerLitre: 88.9 },
] as const;

/** Reducing-balance amortisation — the same formula a bank quotes. */
export function emiMonthly(
  principalInr: number,
  tenorMonths: number,
  apr: number = MONEY.EMI_APR,
): number {
  const r = apr / 12;
  const f = Math.pow(1 + r, tenorMonths);
  return Math.round((principalInr * r * f) / (f - 1));
}

export function invoiceFaceValue(shipment: EscrowShipment): number {
  return shipment.totalAmountInr + Math.round(shipment.totalAmountInr * MONEY.GST_RATE);
}

export interface DiscountQuote {
  faceValueInr: number;
  feeInr: number;
  netInr: number;
  dueAt: number;
}

export function quoteDiscount(shipment: EscrowShipment, termDays: number): DiscountQuote {
  const faceValueInr = invoiceFaceValue(shipment);
  const feeInr = Math.round(faceValueInr * MONEY.DISCOUNT_FEE_RATE_PER_30D * (termDays / 30));
  return {
    faceValueInr,
    feeInr,
    netInr: faceValueInr - feeInr,
    dueAt: Date.now() + termDays * 24 * 3600 * 1000,
  };
}

/** Sanctioned revolving limit from the TruckScore. */
export function limitForScore(score: number, role: 'driver' | 'dealer' | null): number {
  const base = role === 'dealer' ? 1.5 : 1;
  if (score >= 750) return Math.round(200000 * base);
  if (score >= 620) return Math.round(100000 * base);
  if (score >= 480) return Math.round(40000 * base);
  return Math.round(10000 * base);
}

export interface VehicleLoanQuote {
  amountInr: number;
  tenorMonths: number;
  aprPercent: number;
  emiInr: number;
  maxEligibleInr: number;
  eligible: boolean;
}

/** Score-priced APR — better platform history, cheaper truck finance. */
export function vehicleLoanQuote(
  score: number,
  amountInr: number,
  tenorMonths: number,
): VehicleLoanQuote {
  const apr = score >= 750 ? 0.125 : score >= 620 ? 0.145 : score >= 480 ? 0.17 : 0.21;
  const maxEligibleInr =
    score >= 750 ? 2500000 : score >= 620 ? 1500000 : score >= 480 ? 600000 : 150000;
  return {
    amountInr,
    tenorMonths,
    aprPercent: Math.round(apr * 1000) / 10,
    emiInr: emiMonthly(amountInr, tenorMonths, apr),
    maxEligibleInr,
    eligible: amountInr <= maxEligibleInr,
  };
}

const BASE_PREMIUM_RATE = 0.0225;

export interface InsuranceQuote {
  sumInsuredInr: number;
  basePremiumInr: number;
  drivingScore: number | null;
  discountPercent: number;
  premiumInr: number;
  savedInr: number;
}

export function insuranceQuote(
  sumInsuredInr: number,
  driving: { score: number; discountPercent: number } | null,
): InsuranceQuote {
  const basePremiumInr = Math.round(sumInsuredInr * BASE_PREMIUM_RATE);
  const discountPercent = driving?.discountPercent ?? 0;
  const premiumInr = Math.round(basePremiumInr * (1 - discountPercent / 100));
  return {
    sumInsuredInr,
    basePremiumInr,
    drivingScore: driving?.score ?? null,
    discountPercent,
    premiumInr,
    savedInr: basePremiumInr - premiumInr,
  };
}

export function fuelSwipeMath(litres: number, dieselInrPerLitre: number): {
  grossInr: number;
  discountInr: number;
  cashbackInr: number;
  netInr: number;
} {
  const grossInr = Math.round(litres * dieselInrPerLitre);
  const discountInr = Math.round(litres * MONEY.FUEL_DISCOUNT_INR_PER_LITRE);
  const afterDiscount = grossInr - discountInr;
  const cashbackInr = Math.round(afterDiscount * MONEY.FUEL_CASHBACK_RATE);
  return { grossInr, discountInr, cashbackInr, netInr: afterDiscount - cashbackInr };
}
