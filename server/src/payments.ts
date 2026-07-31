/**
 * Payment rails.
 *
 * Two modes, decided by environment:
 *   RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set → real calls to Razorpay
 *   (payouts for escrow money movement); otherwise → simulated references
 *   with identical shapes, so the rest of the server never branches.
 *
 * FASTag top-ups use UPI intent deep links (upi://pay?...) — the app opens
 * the user's UPI app directly; no SDK needed. In production the credit
 * should be confirmed by the PSP webhook (`/v1/payments/webhook`), not by
 * the client — the webhook's HMAC verification below is the security-
 * critical piece and is fully implemented and unit-tested.
 */

import crypto from 'crypto';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
/** RazorpayX virtual account funding the payouts. */
const RAZORPAYX_ACCOUNT = process.env.RAZORPAYX_ACCOUNT_NUMBER ?? '';
/** VPA that receives FASTag top-ups. */
const UPI_PAYEE_VPA = process.env.UPI_PAYEE_VPA ?? 'trucksetu.demo@upi';

export const paymentsMode: 'razorpay' | 'simulated' =
  RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET ? 'razorpay' : 'simulated';

export interface PayoutResult {
  referenceId: string;
  mode: typeof paymentsMode;
}

/**
 * Move escrow money to the driver: the advance on dispatch, the balance on
 * release. Real mode calls RazorpayX Payouts; simulated mode fabricates the
 * same reference shape the app already renders in the timeline.
 */
export async function executePayout(
  kind: 'advance' | 'balance',
  shipmentId: string,
  amountInr: number,
): Promise<PayoutResult> {
  if (paymentsMode === 'razorpay') {
    const response = await fetch('https://api.razorpay.com/v1/payouts', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_number: RAZORPAYX_ACCOUNT,
        amount: amountInr * 100, // paise
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        narration: `TruckSetu ${kind} ${shipmentId}`.slice(0, 30),
      }),
    });
    if (!response.ok) {
      throw new Error(`Razorpay payout failed (${response.status})`);
    }
    const data = (await response.json()) as { id: string };
    return { referenceId: data.id, mode: 'razorpay' };
  }

  const prefix = kind === 'advance' ? 'ADV' : 'BAL';
  return { referenceId: `${prefix}-${shipmentId}-${amountInr}`, mode: 'simulated' };
}

/**
 * Build a UPI intent deep link for a FASTag top-up. Any UPI app (GPay,
 * PhonePe, Paytm, BHIM) registered for the upi:// scheme handles it.
 */
export function buildUpiIntent(amountInr: number, note: string): { upiUri: string; payeeVpa: string } {
  const params = new URLSearchParams({
    pa: UPI_PAYEE_VPA,
    pn: 'TruckSetu',
    am: String(amountInr),
    cu: 'INR',
    tn: note,
  });
  return { upiUri: `upi://pay?${params.toString()}`, payeeVpa: UPI_PAYEE_VPA };
}

/**
 * Razorpay webhook signature check: HMAC-SHA256 of the RAW request body
 * with the webhook secret, hex-encoded, compared in constant time.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
