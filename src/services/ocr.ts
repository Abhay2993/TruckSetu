/**
 * POD OCR — consignment-number extraction (Feature 12).
 *
 * `readConsignmentNo` is the pluggable seam: production wires Google Cloud
 * Vision, AWS Textract, or on-device ML Kit here to read the LR/consignment
 * number off the POD image. Until then it simulates a realistic read:
 *   • a photo captured on the delivery whose expected number we know →
 *     usually reads it correctly, occasionally a near-miss (the exact case
 *     the verification step exists to catch),
 *   • otherwise → a plausible LR number.
 * The rest of the app treats the result identically regardless of source.
 */

const LR_RE = /\b(?:LR|CN|GR)[-\s]?\d{4,6}\b/i;

export interface OcrResult {
  consignmentNo: string | null;
  /** 0..1 confidence — surfaced so low-confidence reads can be re-shot. */
  confidence: number;
}

export async function readConsignmentNo(
  _uri: string,
  expected?: string,
): Promise<OcrResult> {
  // Simulate the OCR round-trip latency a real API/model would add.
  await new Promise((r) => setTimeout(r, 600));

  if (expected) {
    // 80% clean read, 20% a transposed digit → a genuine mismatch to catch.
    if (Math.random() < 0.8) {
      return { consignmentNo: expected, confidence: 0.93 };
    }
    const scrambled = expected.replace(/\d(?=\d*$)/, (d) => String((Number(d) + 1) % 10));
    return { consignmentNo: scrambled, confidence: 0.71 };
  }

  const match = LR_RE.exec(_uri);
  return { consignmentNo: match ? match[0].toUpperCase() : 'LR-00000', confidence: 0.6 };
}
