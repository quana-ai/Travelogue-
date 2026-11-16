import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as fs from 'fs';
import * as path from 'path';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface ExtractedField {
  value: string;
  confidence: 'found' | 'uncertain' | 'missing';
}

export interface OcrResult {
  isReceipt: boolean;
  error?: string;
  quality: 'readable' | 'blurry' | 'unreadable' | 'incomplete';
  merchant: ExtractedField;
  date: ExtractedField;
  billNo: ExtractedField;
  items: ExtractedField;
  total: ExtractedField;
  tax: ExtractedField;
  currency: ExtractedField;
  payment: ExtractedField;
}

type PdfJs = typeof import('pdfjs-dist');

interface WorkerResponse {
  candidate?: boolean;
  confidence?: number;
  error?: string;
  quality?: 'blurry' | 'readable' | 'unreadable';
  text?: string;
}

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly maxPdfPages = 10;
  private workerProcess: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private pendingResponse: {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  } | null = null;
  private queue: Promise<void> = Promise.resolve();

  async processBillImage(buffer: Buffer, mimeType: string): Promise<OcrResult> {
    let pages: Buffer[];
    try {
      if (mimeType === 'application/pdf') {
        pages = await this.renderPdfPages(buffer);
      } else {
        await loadImage(buffer);
        pages = [buffer];
      }
    } catch (error) {
      console.error('Uploaded bill could not be decoded:', error);
      throw new BadRequestException('No valid bill detected. Please upload a valid bill or receipt.');
    }

    const recognition = this.queue.then(async () => {
      const candidates: Buffer[] = [];
      const detections: WorkerResponse[] = [];
      for (const page of pages) {
        const detection = await this.detectDocumentCandidate(page);
        detections.push(detection);
        if (detection.candidate) candidates.push(page);
      }

      if (!candidates.length) {
        if (detections.some((detection) => detection.quality === 'blurry')) {
          return this.invalidResult('blurry', 'This bill is too blurry to read. Please upload a clearer image.');
        }
        return this.invalidResult('unreadable', 'No valid bill detected. Please upload a valid bill or receipt.');
      }

      const texts: string[] = [];
      let totalConfidence = 0;
      let recognizedPages = 0;
      for (const page of candidates) {
        const result = await this.runWorker('recognize', page);
        texts.push(result.text || '');
        if (result.text?.trim()) {
          totalConfidence += result.confidence || 0;
          recognizedPages += 1;
        }
      }
      return this.validateRecognizedText(
        texts.join('\n'),
        recognizedPages ? totalConfidence / recognizedPages : 0,
      );
    });
    this.queue = recognition.then(() => undefined, () => undefined);

    try {
      return await recognition;
    } catch (error) {
      console.error('PaddleOCR validation failed:', error);
      throw new ServiceUnavailableException(
        'Local bill recognition is unavailable. Please check the PaddleOCR setup and try again.',
      );
    }
  }

  async onModuleDestroy() {
    if (this.pendingResponse) {
      clearTimeout(this.pendingResponse.timeout);
      this.pendingResponse.reject(new Error('PaddleOCR worker stopped.'));
      this.pendingResponse = null;
    }
    this.workerProcess?.kill();
    this.workerProcess = null;
  }

  private detectDocumentCandidate(buffer: Buffer): Promise<WorkerResponse> {
    return this.runWorker('detect', buffer);
  }

  private runWorker(mode: 'detect' | 'recognize', buffer: Buffer): Promise<WorkerResponse> {
    const worker = this.getWorkerProcess();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponse = null;
        if (this.workerProcess === worker) this.workerProcess = null;
        worker.kill();
        reject(new Error('PaddleOCR worker timed out.'));
      }, 5 * 60 * 1000);
      this.pendingResponse = { resolve, reject, timeout };

      worker.stdin.write(JSON.stringify({
        mode,
        image: buffer.toString('base64'),
      }) + '\n', (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pendingResponse = null;
        reject(error);
      });
    });
  }

  private getWorkerProcess(): ChildProcessWithoutNullStreams {
    if (this.workerProcess && this.workerProcess.exitCode === null && !this.workerProcess.killed) {
      return this.workerProcess;
    }

    const virtualEnvPython = path.join(
      process.cwd(),
      '.venv-ocr',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    const python = process.env.PADDLE_OCR_PYTHON
      || (fs.existsSync(virtualEnvPython) ? virtualEnvPython : process.platform === 'win32' ? 'python' : 'python3');
    const worker = spawn(python, [path.join(__dirname, 'paddle_worker.py')], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PADDLE_PDX_CACHE_HOME: process.env.PADDLE_PDX_CACHE_HOME || path.join(process.cwd(), '.paddlex'),
      },
    });
    this.workerProcess = worker;
    this.stdoutBuffer = '';

    worker.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() || '';
      for (const line of lines) this.handleWorkerResponse(line);
    });
    worker.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) console.error('[PaddleOCR worker]', message);
    });
    worker.on('error', (error) => this.failWorker(error));
    worker.on('exit', (code, signal) => {
      if (this.workerProcess === worker) this.workerProcess = null;
      if (this.pendingResponse) {
        this.failWorker(new Error(`PaddleOCR worker exited (code ${code}, signal ${signal}).`));
      }
    });

    return worker;
  }

  private handleWorkerResponse(line: string) {
    const pending = this.pendingResponse;
    if (!pending) {
      if (line.trim()) console.error('[PaddleOCR worker] Unexpected output:', line);
      return;
    }

    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch (error) {
      console.error('[PaddleOCR worker] Invalid response:', error);
      this.failWorker(new Error('PaddleOCR worker returned an invalid response.'));
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingResponse = null;
    if (response.error) {
      console.error('[PaddleOCR worker] Recognition error:', response.error);
      pending.reject(new Error('PaddleOCR could not process this document.'));
    } else {
      pending.resolve(response);
    }
  }

  private failWorker(error: Error) {
    const pending = this.pendingResponse;
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingResponse = null;
    pending.reject(error);
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

  private invalidResult(
    quality: OcrResult['quality'],
    error: string,
  ): OcrResult {
    return {
      isReceipt: false,
      quality,
      error,
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

  validateRecognizedText(text: string, recognitionConfidence: number): OcrResult {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const readableLines = lines.filter((line) => !/^(tax invoice|invoice|receipt|bill|thank you)\b/i.test(line));
    const merchant = readableLines.find((line) => !this.isTransactionLine(line)) || '';
    const dateLine = lines.find((line) => /\b(?:date|dated|invoice date)\b/i.test(line) || this.parseDate(line));
    const billNumberLine = lines.find((line) => /\b(?:invoice|bill|receipt)\s*(?:no\.?|number|#|:)\b/i.test(line));
    const totalLine = [...lines].reverse().find((line) =>
      /\b(?:grand\s+total|total\s+amount|amount\s+(?:due|paid)|balance\s+due|net\s+payable|total)\b/i.test(line)
      && !/\b(?:sub\s*total|taxable)\b/i.test(line)
      && this.parseAmount(line) !== '',
    );
    const taxLine = lines.find((line) => !/\bGSTIN\b/i.test(line)
      && /\b(?:tax|gst|vat|cgst|sgst|igst)\b/i.test(line)
      && this.parseAmount(line) !== '');
    const paymentLine = lines.find((line) => /\b(?:cash|credit card|debit card|visa|mastercard|upi|payment|paid by)\b/i.test(line));

    const date = dateLine ? this.parseDate(dateLine) : '';
    const billNoMatch = billNumberLine?.match(/(?:no\.?|number|#|:)\s*([A-Z0-9][A-Z0-9./_-]{2,})/i);
    const hasReceiptHeading = /\b(?:receipt|tax invoice|invoice|bill|GSTIN|GST\s*IN|invoice\s*no)\b/i.test(text);
    const hasAmount = Boolean(totalLine);
    const itemLines = this.extractItems(lines);
    const hasReceiptDetails = Boolean(date || billNoMatch || taxLine || paymentLine || itemLines.length >= 2);
    const isReadable = lines.length > 0 && recognitionConfidence >= 40;
    const isReceipt = isReadable && Boolean(
      merchant && hasAmount && hasReceiptDetails && (hasReceiptHeading || date || billNoMatch || taxLine || paymentLine),
    );
    const currency = /\b(?:INR|Rs\.?)\b|₹/i.test(text)
      ? 'INR'
      : /\bUSD\b|\$/i.test(text)
        ? 'USD'
        : /\bEUR\b|€/i.test(text)
          ? 'EUR'
          : '';

    if (!isReceipt) {
      const quality = !lines.length ? 'unreadable'
        : recognitionConfidence < 40 ? 'blurry'
          : hasReceiptHeading || hasReceiptDetails ? 'incomplete' : 'readable';
      const error = quality === 'blurry'
          ? 'This bill is too blurry to read. Please upload a clearer image.'
          : quality === 'unreadable'
            ? 'This bill could not be read. Please upload a clear, well-lit image.'
          : quality === 'incomplete'
            ? 'This bill looks incomplete or unreadable. Please upload a clear, full image of the bill or receipt.'
            : 'No valid bill detected. Please upload a valid bill or receipt.';
      return this.invalidResult(quality, error);
    }

    return {
      isReceipt: true,
      quality: 'readable',
      merchant: this.field(merchant),
      date: this.field(date),
      billNo: this.field(billNoMatch?.[1] || ''),
      items: this.field(itemLines.join('\n')),
      total: this.field(totalLine ? this.parseAmount(totalLine) : ''),
      tax: this.field(taxLine ? this.parseAmount(taxLine) : ''),
      currency: this.field(currency),
      payment: this.field(paymentLine || ''),
    };
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
