import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeContact } from '../src/common/contact';
import { CryptoService } from '../src/crypto/crypto.service';
import { OcrService } from '../src/ocr/ocr.service';
import { ConfigService } from '@nestjs/config';

describe('Contact Normalization', () => {
  it('normalizes emails to lowercase', () => {
    assert.strictEqual(normalizeContact('  User@Example.COM '), 'user@example.com');
  });

  it('normalizes 10-digit Indian phone numbers', () => {
    assert.strictEqual(normalizeContact('9876543210'), '+919876543210');
    assert.strictEqual(normalizeContact('+91 9876543210'), '+919876543210');
  });

  it('normalizes 11-digit phone numbers with leading 0', () => {
    assert.strictEqual(normalizeContact('09876543210'), '+919876543210');
  });

  it('normalizes 12-digit numbers starting with 91', () => {
    assert.strictEqual(normalizeContact('919876543210'), '+919876543210');
  });
});

describe('CryptoService AES-256-GCM', () => {
  const config = new ConfigService({ ENCRYPTION_KEY: 'travelogue_32_byte_aes_key_dev!!' });
  const cryptoService = new CryptoService(config);

  it('encrypts and decrypts field text', () => {
    const text = 'Cafe Coffee Day';
    const encrypted = cryptoService.encryptField(text);
    assert.notStrictEqual(encrypted, text);
    const decrypted = cryptoService.decryptField(encrypted);
    assert.strictEqual(decrypted, text);
  });

  it('encrypts and decrypts binary buffers with SHA-256 verification', () => {
    const data = Buffer.from('PDF receipt sample file data 2026');
    const hash = cryptoService.calculateSha256(data);
    const { iv, ciphertext, tag } = cryptoService.encryptBuffer(data);
    const decrypted = cryptoService.decryptBuffer(ciphertext, iv, tag);
    assert.strictEqual(cryptoService.calculateSha256(decrypted), hash);
  });
});

describe('OCR Receipt Heuristic Extraction', () => {
  const ocrService = new OcrService();

  it('extracts merchant, date, invoice number, tax, and total correctly', () => {
    const text = `
*** TAX INVOICE ***
CAFE COFFEE DAY
Date: 14/11/2026
Invoice No: CCD-98214
Cappuccino: INR 250.00
GST 5%: INR 12.50
Total items: 1 Total Amount: INR 262.50
Paid by UPI
    `.trim();

    const result = (ocrService as any).parseReceiptText(text);
    assert.strictEqual(result.isReceipt, true);
    assert.strictEqual(result.merchant.value, 'CAFE COFFEE DAY');
    assert.strictEqual(result.date.value, '2026-11-14');
    assert.strictEqual(result.billNo.value, 'CCD-98214');
    assert.strictEqual(result.tax.value, '12.50');
    assert.strictEqual(result.total.value, '262.50');
    assert.strictEqual(result.currency.value, 'INR');
  });

  it('correctly handles Invoice with colon or hash and month-first dates', () => {
    const text = `
RECEIPT
BLUE SKY DINER
Date: 11/25/2026
Invoice: INV-9901
Meal: $40.00
Tax: $3.50
Total Amount: $43.50
Paid by Credit Card
    `.trim();

    const result = (ocrService as any).parseReceiptText(text);
    assert.strictEqual(result.isReceipt, true);
    assert.strictEqual(result.merchant.value, 'BLUE SKY DINER');
    assert.strictEqual(result.date.value, '2026-11-25');
    assert.strictEqual(result.billNo.value, 'INV-9901');
    assert.strictEqual(result.tax.value, '3.50');
    assert.strictEqual(result.total.value, '43.50');
  });

  it('identifies non-receipt document as INVALID_DOCUMENT', () => {
    const text = 'A beautiful mountain landscape on a sunny afternoon in the Alps.';
    const result = (ocrService as any).parseReceiptText(text);
    assert.strictEqual(result.isReceipt, false);
  });
});
