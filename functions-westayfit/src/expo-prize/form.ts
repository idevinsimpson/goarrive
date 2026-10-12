/**
 * EXPO PRIZE — the trusted form-receipt seam.
 *
 * The core never accepts a receipt OBJECT from a caller. It accepts a receipt
 * ID and re-reads it through this adapter against the owning store, on the
 * server. Which store backs it — the Lovable-owned `interest_responses`
 * capture (DATA_OWNERSHIP.md:29) or a promotion-scoped form submitted from the
 * signed-in app — is an owner decision recorded in CONTRACT.md §(e). No live
 * binding exists in this packet.
 *
 * Consent is not part of the receipt the core sees. A marketing opt-in or
 * opt-out stays in the marketing system of record and cannot alter
 * eligibility.
 */
import type { FormReceipt } from './adjudicate';

export interface FormReceiptSource {
  /** Resolve a receipt id server-side. null = no such receipt (a forged id is refused). */
  read(receiptId: string): Promise<FormReceipt | null>;
}

/**
 * SYNTHETIC. An in-memory source for emulator tests and nothing else. It is
 * exported so tests can seed receipts; it must never be wired to a callable.
 */
export class InMemoryFormReceiptSource implements FormReceiptSource {
  private readonly receipts = new Map<string, FormReceipt>();

  seed(receipt: FormReceipt): void {
    this.receipts.set(receipt.receiptId, { ...receipt });
  }

  async read(receiptId: string): Promise<FormReceipt | null> {
    const found = this.receipts.get(receiptId);
    return found ? { ...found } : null;
  }
}
