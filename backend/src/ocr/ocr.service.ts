import { BadRequestException, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as path from 'path';
import Tesseract = require('tesseract.js');
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type OcrErrorCode =
  | 'INVALID_FILE_TYPE'
  | 'IMAGE_QUALITY_LOW'
  | 'NOT_A_BILL'
  | 'OCR_LOW_CONFIDENCE'
  | 'NO_TEXT_DETECTED';

export interface OcrConfig {
  minConfidence: number;
  minTextLength: number;
  blurThreshold: number;
  minBrightness: number;
  maxBrightness: number;
  minContrastStdDev: number;
  maxFileSize: number;
  allowedMimeTypes: string[];
}

export interface ExtractedField {
  value: string;
  confidence: 'found' | 'uncertain' | 'missing';
}

export interface OcrResult {
  isReceipt: boolean;
  errorCode?: OcrErrorCode;
  statusCode?: 400 | 422;
  error?: string;
  quality: 'readable' | 'blurry' | 'unreadable' | 'incomplete' | 'blank' | 'dark' | 'corrupt';
  merchant: ExtractedField;
  date: ExtractedField;
  billNo: ExtractedField;
  items: ExtractedField;
  total: ExtractedField;
  tax: ExtractedField;
  currency: ExtractedField;
  payment: ExtractedField;
  suggestedCategory?: string;
  suggestedSubcategory?: string;
  categoryConfidence?: 'found' | 'uncertain' | 'missing';
}

type PdfJs = typeof import('pdfjs-dist');

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly maxPdfPages = 10;
  private workerPromise: Promise<Tesseract.Worker> | null = null;
  private queue: Promise<void> = Promise.resolve();
  public readonly config: OcrConfig;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() configOverrides?: Partial<OcrConfig>,
  ) {
    this.config = {
      minConfidence: this.getNumberConfig('OCR_MIN_CONFIDENCE', 35),
      minTextLength: this.getNumberConfig('OCR_MIN_TEXT_LENGTH', 15),
      blurThreshold: this.getNumberConfig('OCR_BLUR_THRESHOLD', 40),
      minBrightness: this.getNumberConfig('OCR_MIN_BRIGHTNESS', 25),
      maxBrightness: this.getNumberConfig('OCR_MAX_BRIGHTNESS', 252),
      minContrastStdDev: this.getNumberConfig('OCR_MIN_CONTRAST_STDDEV', 8),
      maxFileSize: this.getNumberConfig('OCR_MAX_FILE_SIZE', 10 * 1024 * 1024),
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'],
      ...configOverrides,
    };
  }

  private getNumberConfig(key: string, defaultValue: number): number {
    const val = this.configService?.get<string | number>(key) ?? process.env[key];
    if (val !== undefined && val !== null && val !== '') {
      const num = Number(val);
      if (!Number.isNaN(num)) return num;
    }
    return defaultValue;
  }

  /**
   * Validates file signature / magic bytes against declared MIME type.
   */
  verifyFileType(buffer: Buffer, mimeType: string): { valid: boolean; detectedMime?: string } {
    if (!buffer || buffer.length < 4) {
      return { valid: false };
    }

    const normMime = (mimeType || '').toLowerCase();

    // PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { valid: normMime === 'application/pdf', detectedMime: 'application/pdf' };
    }

    // JPEG magic bytes: 0xFF 0xD8 0xFF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: normMime === 'image/jpeg' || normMime === 'image/jpg', detectedMime: 'image/jpeg' };
    }

    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { valid: normMime === 'image/png', detectedMime: 'image/png' };
    }

    // WebP magic bytes: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return { valid: normMime === 'image/webp', detectedMime: 'image/webp' };
    }

    return { valid: false };
  }

  /**
   * Pre-OCR check: inspects image quality (decode, blank, too dark, blur, document-like contrast).
   */
  async validateImageQuality(imageBuffer: Buffer): Promise<{
    valid: boolean;
    quality: OcrResult['quality'];
    error?: string;
    errorCode?: OcrErrorCode;
  }> {
    let img: any;
    try {
      img = await loadImage(imageBuffer);
    } catch {
      return {
        valid: false,
        quality: 'corrupt',
        error: 'The image file is corrupt or could not be decoded. Please upload a valid image.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }

    if (!img || !img.width || !img.height || img.width <= 0 || img.height <= 0) {
      return {
        valid: false,
        quality: 'corrupt',
        error: 'The image has invalid dimensions. Please upload a valid bill.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }

    // Standardize to max 300x300 for fast, consistent analysis
    const maxDim = 300;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(10, Math.round(img.width * scale));
    const h = Math.max(10, Math.round(img.height * scale));

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let sum = 0;
    let sumSq = 0;
    const gray = new Float32Array(w * h);

    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[i / 4] = y;
      sum += y;
      sumSq += y * y;
    }

    const n = w * h;
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);
    const stdDev = Math.sqrt(Math.max(0, variance));

    // 1. Check too dark
    if (mean < this.config.minBrightness) {
      return {
        valid: false,
        quality: 'dark',
        error: 'The uploaded image is too dark to read. Please upload a well-lit bill.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }

    // 2. Check blank / solid color
    if (stdDev < this.config.minContrastStdDev) {
      return {
        valid: false,
        quality: 'blank',
        error: 'The uploaded image appears to be blank. Please upload a clear bill or receipt.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }
    if (mean > this.config.maxBrightness && stdDev < this.config.minContrastStdDev * 1.5) {
      return {
        valid: false,
        quality: 'blank',
        error: 'The uploaded image appears to be blank. Please upload a clear bill or receipt.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }

    // 3. Check blur (Laplacian variance on grayscale)
    let lapSum = 0;
    let lapSumSq = 0;
    let lapCount = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const val = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
        lapSum += val;
        lapSumSq += val * val;
        lapCount++;
      }
    }

    const lapMean = lapSum / lapCount;
    const lapVar = (lapSumSq / lapCount) - (lapMean * lapMean);

    if (lapVar < this.config.blurThreshold) {
      return {
        valid: false,
        quality: 'blurry',
        error: 'This bill is too blurry to read. Please upload a clearer image.',
        errorCode: 'IMAGE_QUALITY_LOW',
      };
    }

    return { valid: true, quality: 'readable' };
  }

  async processBillImage(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    // 1. Pre-OCR Check: File size
    if (!buffer || buffer.length === 0 || buffer.length > this.config.maxFileSize) {
      return this.createFailureResult(
        'INVALID_FILE_TYPE',
        'File size must be greater than 0 and less than 10MB.',
        400,
        'unreadable',
      );
    }

    // 2. Pre-OCR Check: File format / signature
    const typeCheck = this.verifyFileType(buffer, mimeType);
    if (!typeCheck.valid) {
      return this.createFailureResult(
        'INVALID_FILE_TYPE',
        'Invalid file type. Only JPEG, PNG, WebP image and PDF files are supported.',
        400,
        'unreadable',
      );
    }

    let pages: Buffer[];
    if (mimeType === 'application/pdf') {
      try {
        pages = await this.renderPdfPages(buffer);
      } catch (error) {
        return this.createFailureResult(
          'IMAGE_QUALITY_LOW',
          'PDF could not be decoded. Please upload a valid PDF file.',
          400,
          'corrupt',
        );
      }
    } else {
      // 3. Pre-OCR Check: Image Quality (decode, blank, dark, blur)
      const qualityCheck = await this.validateImageQuality(buffer);
      if (!qualityCheck.valid) {
        return this.createFailureResult(
          qualityCheck.errorCode || 'IMAGE_QUALITY_LOW',
          qualityCheck.error || 'Image quality is too low. Please upload a clear bill.',
          400,
          qualityCheck.quality || 'unreadable',
        );
      }
      pages = [buffer];
    }

    // 4. Run OCR (if an image fails, retry it turned 90/270/180 degrees: phone photos are often sideways)
    const first = await this.recognizePages(pages);
    let best = this.validateRecognizedText(first.text, first.confidence);
    if (!best.isReceipt && mimeType !== 'application/pdf' && first.text.trim()) {
      for (const deg of [90, 270, 180]) {
        const rotated = await this.rotateImage(buffer, deg).catch(() => null);
        if (!rotated) continue;
        const attempt = await this.recognizePages([rotated]);
        const validated = this.validateRecognizedText(attempt.text, attempt.confidence);
        if (validated.isReceipt) { best = validated; break; }
      }
    }
    return best;
  }

  private async rotateImage(buffer: Buffer, deg: number): Promise<Buffer> {
    const img = await loadImage(buffer);
    const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const swap = deg === 90 || deg === 270;
    const canvas = createCanvas(swap ? h : w, swap ? w : h);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return canvas.toBuffer('image/png');
  }

  private async recognizePages(pages: Buffer[]): Promise<{ text: string; confidence: number }> {
    const recognition = this.queue.then(async () => {
      const worker = await this.getWorker();
      const texts: string[] = [];
      const confidences: number[] = [];
      for (const page of pages) {
        const result = await worker.recognize(page);
        texts.push(result.data.text);
        if (result.data.text.trim()) confidences.push(result.data.confidence);
      }
      return {
        text: texts.join('\n'),
        confidence: confidences.length
          ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
          : 0,
      };
    });
    this.queue = recognition.then(() => undefined, () => undefined);
    return recognition;
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

  validateRecognizedText(text: string, recognitionConfidence: number): OcrResult {
    const rawTrimmed = (text || '').trim();

    // 1. Post-OCR Check: Empty text
    if (!rawTrimmed || rawTrimmed.length === 0) {
      return this.createFailureResult(
        'NO_TEXT_DETECTED',
        'No text detected in the uploaded image. Please ensure the bill is clear and legible.',
        422,
        'unreadable',
      );
    }

    // 2. Post-OCR Check: Text too short
    if (rawTrimmed.length < this.config.minTextLength) {
      return this.createFailureResult(
        'NO_TEXT_DETECTED',
        'Text detected is too short to be a valid bill. Please upload a full bill or receipt.',
        422,
        'incomplete',
      );
    }

    // 3. Post-OCR Check: Confidence threshold
    if (recognitionConfidence < this.config.minConfidence) {
      return this.createFailureResult(
        'OCR_LOW_CONFIDENCE',
        'This bill is too blurry to read. Please upload a clearer image.',
        422,
        'blurry',
      );
    }

    // 4. Post-OCR Check: Bill structure & fields parsing
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const merchant = this.extractMerchant(lines);
    const dateLine = lines.find((line) => /\b(?:date|dated|invoice\s*date|bill\s*date)\b/i.test(line) || this.parseDate(line));
    const date = dateLine ? this.parseDate(dateLine) : lines.map((l) => this.parseDate(l)).find(Boolean) || '';
    const billNo = this.extractBillNo(lines);
    const total = this.extractTotal(lines);
    const tax = this.extractTax(lines);
    const paymentLine = lines.find((line) => /\b(?:cash|credit\s*card|debit\s*card|visa|mastercard|upi|gpay|paytm|phonepe|net\s*banking|paid\s*by|payment\s*method)\b/i.test(line));

    const hasReceiptHeading = /\b(?:receipt|tax\s*invoice|retail\s*invoice|invoice|bill|gstin|gst\s*in|cash\s*memo|cash\s*bill|inv(?:oice)?\s*no)\b/i.test(text);
    const hasAmount = Boolean(total);
    const itemLines = this.extractItems(lines);
    const hasReceiptDetails = Boolean(date || billNo || tax || paymentLine || itemLines.length >= 2);

    // A bill needs several independent bill signals. A missing merchant or a cut-off total alone
    // should not reject a real bill (the user can fill those in), but random text or a photo of
    // something else rarely shows 3+ of these together.
    const signals = [hasReceiptHeading, Boolean(date), Boolean(billNo), Boolean(tax), Boolean(paymentLine), itemLines.length >= 2, hasAmount]
      .filter(Boolean).length;
    const isReceipt = signals >= 3 && (hasAmount || itemLines.length >= 2) && (hasReceiptHeading || Boolean(billNo) || Boolean(tax));

    const currency = /\b(?:INR|Rs\.?)\b|₹/i.test(text)
      ? 'INR'
      : /\bUSD\b|\$/i.test(text)
        ? 'USD'
        : /\bEUR\b|€/i.test(text)
          ? 'EUR'
          : /\bGBP\b|£/i.test(text)
            ? 'GBP'
            : '';

    if (!isReceipt) {
      const quality = signals >= 2 && (hasReceiptHeading || Boolean(billNo)) ? 'incomplete' : 'readable';
      return this.createFailureResult(
        'NOT_A_BILL',
        quality === 'incomplete'
          ? 'This bill looks incomplete or unreadable. Please upload a clear, full image of the bill or receipt.'
          : 'No valid bill detected. Please upload a valid bill or receipt.',
        422,
        quality,
      );
    }

    const { category: suggestedCategory, subcategory: suggestedSubcategory } = this.categorizeBill(
      text,
      merchant,
      itemLines.join('\n'),
    );

    return {
      isReceipt: true,
      quality: 'readable',
      merchant: this.field(merchant),
      date: this.field(date),
      billNo: this.field(billNo),
      items: this.field(itemLines.join('\n')),
      total: this.field(total),
      tax: this.field(tax),
      currency: this.field(currency),
      payment: this.field(paymentLine || ''),
      suggestedCategory,
      suggestedSubcategory,
      categoryConfidence: 'found',
    };
  }

  categorizeBill(text: string, merchant: string, items: string): { category: string; subcategory: string } {
    const combined = `${merchant} ${items} ${text}`.toLowerCase();

    // 1. Fuel
    if (/\b(?:petrol|diesel|fuel|cng|shell|hpcl|bpcl|iocl|service\s*station|petroleum|dispenser|nozzle)\b/i.test(combined)) {
      const sub = /\bdiesel\b/i.test(combined) ? 'Diesel' : 'Petrol';
      return { category: 'Fuel', subcategory: sub };
    }

    // 2. Travel
    if (/\b(?:uber|ola|cab|taxi|ride|transit|metro|airline|flight|indigo|air\s*india|spicejet|vistara|airport|train|railway|irctc|toll|fastag|bus|transport)\b/i.test(combined)) {
      let sub = 'Taxi and Cab';
      if (/\b(?:flight|airline|indigo|air\s*india|spicejet|vistara|airport)\b/i.test(combined)) sub = 'Flights';
      else if (/\b(?:train|railway|irctc|metro)\b/i.test(combined)) sub = 'Train';
      return { category: 'Travel', subcategory: sub };
    }

    // 3. Accommodation
    if (/\b(?:hotel|resort|inn|suites|stay|lodge|motel|airbnb|marriott|hyatt|hilton|hostel|check-in|checkout|guest\s*house)\b/i.test(combined)) {
      const sub = /\bserviced\s*apartment\b/i.test(combined) ? 'Serviced Apartment' : 'Hotel';
      return { category: 'Accommodation', subcategory: sub };
    }

    // 4. Meals / Dining
    if (/\b(?:cafe|coffee|restaurant|kitchen|bistro|bar|food|dining|dine|pizza|burger|tea|chai|bakery|starbucks|mcdonald|subway|swiggy|zomato|breakfast|lunch|dinner|meal|sandwich|beverage|beer|wine|pub|sweet|roaster)\b/i.test(combined)) {
      return { category: 'Meals', subcategory: 'Team Meals' };
    }

    // 5. Office
    if (/\b(?:stationery|paper|print|xerox|software|google|microsoft|adobe|aws|subscription|supplies|staples|pen|notebook|courier|postage)\b/i.test(combined)) {
      const sub = /\b(?:software|google|microsoft|adobe|aws|subscription|cloud|saas)\b/i.test(combined) ? 'Software' : 'Stationery';
      return { category: 'Office', subcategory: sub };
    }

    // Default sensible fallback for expenses
    return { category: 'Meals', subcategory: 'Team Meals' };
  }

  createFailureResult(
    errorCode: OcrErrorCode,
    errorMessage: string,
    statusCode: 400 | 422,
    quality: OcrResult['quality'] = 'unreadable',
  ): OcrResult {
    return {
      isReceipt: false,
      errorCode,
      statusCode,
      error: errorMessage,
      quality,
      merchant: this.field(''),
      date: this.field(''),
      billNo: this.field(''),
      items: this.field(''),
      total: this.field(''),
      tax: this.field(''),
      currency: this.field(''),
      payment: this.field(''),
    };
  }

  private extractMerchant(lines: string[]): string {
    const noisePatterns = [
      /^(?:welcome(?:\s+to)?|thank\s+you|thanks|visit\s+again|customer\s+copy|merchant\s+copy|duplicate\s+copy|original(?:\s+copy)?)\b/i,
      /^(?:tax\s+invoice|retail\s+invoice|invoice|bill|cash\s+memo|receipt|cash\s+bill)\b/i,
      /\b(?:gstin|gst\s*no|pan\s*no|cin\s*no|fssai|reg(?:\s*no)?|tin\s*no)\b/i,
      /\b(?:tel|phone|ph|mob|mobile|call|contact|fax|email|www\.|https?:\/\/)\b/i,
      /\b(?:pincode|pin\s*code|pin\s*[-:]?\s*\d{6}|\d{6}\b)/i,
      /^[0-9\W]+$/,
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 2) continue;

      const welcomeMatch = trimmed.match(/^welcome\s+to\s+([A-Za-z0-9 &.,\x27_-]{3,})/i);
      if (welcomeMatch && welcomeMatch[1]) {
        return welcomeMatch[1].trim();
      }

      if (noisePatterns.some((pattern) => pattern.test(trimmed))) continue;
      if (this.isTransactionLine(trimmed)) continue;

      if (/[A-Za-z]{3,}/.test(trimmed)) {
        return trimmed.replace(/^[*#•\s-]+|[*#•\s-]+$/g, '');
      }
    }

    const fallback = lines.find((l) => /[A-Za-z]{2,}/.test(l.trim()) && !this.isTransactionLine(l.trim()));
    return fallback ? fallback.trim() : '';
  }

  private extractBillNo(lines: string[]): string {
    for (const line of lines) {
      const match = line.match(/\b(?:invoice|inv|bill|receipt|order|token|txn|check|doc(?:ument)?)\s*(?:no\.?|num(?:ber)?|id|ref|#|:|-)*\s*[:#-\s]\s*([A-Z0-9][A-Z0-9./_-]{2,})/i);
      if (match && match[1]) {
        const val = match[1].trim();
        if (!/^(?:total|amount|cash|card|due|paid|date|summary|details|tax|gst)$/i.test(val)) {
          return val;
        }
      }
    }
    return '';
  }

  private extractTotal(lines: string[]): string {
    const totalKeywords = /\b(?:grand\s*total|total\s*(?:amount|due|payable)?|net\s*(?:amount|payable|total)?|amount\s*(?:due|paid|payable)?|balance\s*(?:due|payable)?|final\s*amount|bill\s*total|amt\s*due)\b/i;

    // 1. Search in reverse for specific total lines with amount
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (totalKeywords.test(line) && !/\b(?:sub\s*total|taxable)\b/i.test(line)) {
        const amt = this.parseAmount(line);
        if (amt) return amt;
        if (i + 1 < lines.length) {
          const nextAmt = this.parseAmount(lines[i + 1]);
          if (nextAmt) return nextAmt;
        }
      }
    }

    // 2. Generic "TOTAL" label check
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/\btotal\b/i.test(line) && !/\b(?:sub\s*total|taxable)\b/i.test(line)) {
        const amt = this.parseAmount(line);
        if (amt) return amt;
        if (i + 1 < lines.length) {
          const nextAmt = this.parseAmount(lines[i + 1]);
          if (nextAmt) return nextAmt;
        }
      }
    }

    // 3. Line starting with "Amount" or "Net" or "Balance"
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/^\s*(?:amount|net|balance)\s*[:—\-]?\s*/i.test(line) && !/\b(?:tax|gst|subtotal)\b/i.test(line)) {
        const amt = this.parseAmount(line);
        if (amt) return amt;
      }
    }

    return '';
  }

  private extractTax(lines: string[]): string {
    // 1. Explicit total tax line
    const totalTaxLine = lines.find((line) => !/\bGSTIN\b/i.test(line)
      && /\b(?:total\s+tax|tax\s+amount|gst\s+amount|vat\s+amount)\b/i.test(line)
      && this.parseAmount(line) !== '');
    if (totalTaxLine) return this.parseAmount(totalTaxLine);

    // 2. Single tax / GST / VAT line
    const taxLine = lines.find((line) => !/\bGSTIN\b/i.test(line)
      && /\b(?:tax|gst|vat|cgst|sgst|igst)\b/i.test(line)
      && !/\b(?:tax\s+invoice|taxable)\b/i.test(line)
      && this.parseAmount(line) !== '');
    return taxLine ? this.parseAmount(taxLine) : '';
  }

  private isTransactionLine(line: string): boolean {
    return /\b(?:date|dated|invoice|bill|receipt|total|amount|tax|gst|vat|cgst|sgst|igst|cash|card|upi|payment|paid|subtotal|sub\s*total|discount|change|balance)\b/i.test(line)
      || this.parseDate(line) !== '';
  }

  private extractItems(lines: string[]): string[] {
    const excludedLine = /\b(?:grand\s+total|total\s+amount|amount\s+(?:due|paid)|balance\s+due|net\s+payable|sub\s*total|subtotal|taxable|tax|gst|vat|cgst|sgst|igst|invoice|bill\s*(?:no|number)|receipt|date|discount|payment|paid|cash|card|upi)\b/i;
    const items: string[] = [];
    for (const line of lines) {
      if (excludedLine.test(line)) continue;
      const amountMatches = [...line.matchAll(/(?:₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)(?![0-9])/gi)];
      const lastAmount = amountMatches[amountMatches.length - 1];
      if (!lastAmount || !lastAmount[1]) continue;
      const label = line.slice(0, lastAmount.index).replace(/[|:—-]\s*$/, '').trim();
      if (!label || !/[A-Za-z]/.test(label)) continue;
      items.push(`${label} — ${lastAmount[1].replace(/,/g, '')}`);
    }
    return items;
  }

  private field(value: string): ExtractedField {
    return {
      value,
      confidence: value ? 'uncertain' : 'missing',
    };
  }

  private parseAmount(text: string): string {
    const matches = [...text.matchAll(/(?:₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)];
    const match = matches.reverse().find((candidate) =>
      !/^\s*%/.test(text.slice((candidate.index || 0) + candidate[0].length)),
    );
    return match?.[1].replace(/,/g, '') || '';
  }

  private parseDate(text: string): string {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    };

    // 1. ISO 4-digit: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
    const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

    // 2. Day-first 4-digit: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
    const dayFirst4 = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
    if (dayFirst4) return `${dayFirst4[3]}-${dayFirst4[2].padStart(2, '0')}-${dayFirst4[1].padStart(2, '0')}`;

    // 3. Day-first 2-digit: DD-MM-YY, DD/MM/YY, DD.MM.YY
    const dayFirst2 = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
    if (dayFirst2) {
      const day = parseInt(dayFirst2[1], 10);
      const month = parseInt(dayFirst2[2], 10);
      const year = parseInt(dayFirst2[3], 10);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return `20${String(year).padStart(2, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // 4. Day Month Year: 15-Nov-2024, 15 Nov 2024, 15-Nov-24
    const dayMonthYear = text.match(/\b(\d{1,2})[-\s/.]+([A-Za-z]{3,9})[-\s/.]+((?:20)?\d{2})\b/);
    if (dayMonthYear) {
      const m = months[dayMonthYear[2].toLowerCase()];
      if (m) {
        const y = dayMonthYear[3].length === 2 ? `20${dayMonthYear[3]}` : dayMonthYear[3];
        return `${y}-${m}-${dayMonthYear[1].padStart(2, '0')}`;
      }
    }

    // 5. Month Day Year: Nov 15, 2024 or November 15, 2024
    const monthDayYear = text.match(/\b([A-Za-z]{3,9})[-\s/.]+(\d{1,2}),?[-\s/.]+((?:20)?\d{2})\b/);
    if (monthDayYear) {
      const m = months[monthDayYear[1].toLowerCase()];
      if (m) {
        const y = monthDayYear[3].length === 2 ? `20${monthDayYear[3]}` : monthDayYear[3];
        return `${y}-${m}-${monthDayYear[2].padStart(2, '0')}`;
      }
    }

    return '';
  }
}
