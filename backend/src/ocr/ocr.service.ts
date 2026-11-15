import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import * as path from 'path';
import Tesseract = require('tesseract.js');
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface ExtractedField {
  value: string;
  confidence: 'found' | 'uncertain' | 'missing';
}

export interface OcrResult {
  isReceipt: boolean;
  error?: string;
  merchant: ExtractedField;
  date: ExtractedField;
  billNo: ExtractedField;
  total: ExtractedField;
  tax: ExtractedField;
  currency: ExtractedField;
  payment: ExtractedField;
}

type PdfJs = typeof import('pdfjs-dist');

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly maxPdfPages = 10;
  private workerPromise: Promise<Tesseract.Worker> | null = null;
  private queue: Promise<void> = Promise.resolve();

  async processBillImage(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    const pages = mimeType === 'application/pdf'
      ? await this.renderPdfPages(buffer)
      : [buffer];

    const recognition = this.queue.then(async () => {
      const worker = await this.getWorker();
      const texts: string[] = [];
      for (const page of pages) {
        const result = await worker.recognize(page);
        texts.push(result.data.text);
      }
      return texts.join('\n');
    });
    this.queue = recognition.then(() => undefined, () => undefined);

    return this.parseReceiptText(await recognition);
  }

  async onModuleDestroy() {
    const worker = await this.workerPromise?.catch(() => null);
    if (worker) await worker.terminate();
  }

  private async getWorker(): Promise<Tesseract.Worker> {
    if (!this.workerPromise) {
      const languageDataPath = process.env.TESSDATA_PATH
        || path.join(path.dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0');
      this.workerPromise = Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        langPath: languageDataPath,
        cachePath: process.env.TESSERACT_CACHE_PATH || path.join(process.cwd(), '.tesseract-cache'),
        gzip: true,
      });
    }

    try {
      return await this.workerPromise;
    } catch (error) {
      this.workerPromise = null;
      throw error;
    }
  }

  private async renderPdfPages(buffer: Buffer): Promise<Buffer[]> {
    const pdfjs: PdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const document: PDFDocumentProxy = await loadingTask.promise;

    try {
      if (document.numPages > this.maxPdfPages) {
        throw new Error(`PDFs with more than ${this.maxPdfPages} pages are not supported for OCR.`);
      }

      const pages: Buffer[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const initialViewport = page.getViewport({ scale: 2 });
        const scale = Math.min(1, 4000 / Math.max(initialViewport.width, initialViewport.height));
        const viewport = page.getViewport({ scale: 2 * scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context,
          viewport,
        }).promise;
        pages.push(canvas.toBuffer('image/png'));
      }
      return pages;
    } finally {
      await loadingTask.destroy();
    }
  }

  private parseReceiptText(text: string): OcrResult {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const readableLines = lines.filter((line) => !/^(tax invoice|invoice|receipt|bill|thank you)\b/i.test(line));
    const merchant = readableLines[0] || '';
    const dateLine = lines.find((line) => /\b(?:date|dated|invoice date)\b/i.test(line) || this.parseDate(line));
    const billNumberLine = lines.find((line) => /\b(?:invoice|bill|receipt)\s*(?:no\.?|number|#|:)\b/i.test(line));
    const totalLine = [...lines].reverse().find((line) =>
      /\b(?:grand\s+total|total\s+amount|amount\s+(?:due|paid)|balance\s+due|net\s+payable|total)\b/i.test(line)
      && !/\b(?:sub\s*total|taxable)\b/i.test(line)
      && this.parseAmount(line) !== '',
    );
    const taxLine = lines.find((line) => /\b(?:tax|gst|vat|cgst|sgst|igst)\b/i.test(line) && this.parseAmount(line) !== '');
    const paymentLine = lines.find((line) => /\b(?:cash|credit card|debit card|visa|mastercard|upi|payment|paid by)\b/i.test(line));

    const date = dateLine ? this.parseDate(dateLine) : '';
    const billNoMatch = billNumberLine?.match(/(?:no\.?|number|#|:)\s*([A-Z0-9][A-Z0-9./_-]{2,})/i);
    const hasReceiptHeading = /\b(?:receipt|tax invoice|invoice|bill)\b/i.test(text);
    const hasTransactionDetails = Boolean(
      totalLine || billNoMatch || date || (taxLine && this.parseAmount(taxLine)) || paymentLine,
    );
    const isReceipt = hasReceiptHeading
      ? hasTransactionDetails
      : Boolean(totalLine && (date || billNoMatch || taxLine || paymentLine));
    const currency = /\b(?:INR|Rs\.?)\b|₹/i.test(text)
      ? 'INR'
      : /\bUSD\b|\$/i.test(text)
        ? 'USD'
        : /\bEUR\b|€/i.test(text)
          ? 'EUR'
          : '';

    if (!isReceipt) {
      return {
        isReceipt: false,
        error: lines.length
          ? 'This file does not look like a bill or receipt, so no expense details were extracted. Upload a clear image or PDF of a bill, invoice, or receipt. If it is hard to read, try a sharper, well-lit scan.'
          : 'No readable text was found. Upload a clear, well-lit image or PDF of the bill, invoice, or receipt.',
        merchant: this.field(''),
        date: this.field(''),
        billNo: this.field(''),
        total: this.field(''),
        tax: this.field(''),
        currency: this.field(''),
        payment: this.field(''),
      };
    }

    return {
      isReceipt: true,
      merchant: this.field(merchant),
      date: this.field(date),
      billNo: this.field(billNoMatch?.[1] || ''),
      total: this.field(totalLine ? this.parseAmount(totalLine) : ''),
      tax: this.field(taxLine ? this.parseAmount(taxLine) : ''),
      currency: this.field(currency),
      payment: this.field(paymentLine || ''),
    };
  }

  private field(value: string): ExtractedField {
    return {
      value,
      confidence: value ? 'uncertain' : 'missing',
    };
  }

  private parseAmount(text: string): string {
    const match = text.match(/(?:₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
    return match?.[1].replace(/,/g, '') || '';
  }

  private parseDate(text: string): string {
    const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

    const dayFirst = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
    if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;

    const monthName = text.match(/\b(?:\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b/);
    if (!monthName) return '';
    const parsed = new Date(monthName[0]);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
}
