import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Delivers one-time codes.
 *
 * Email: sent over SMTP when SMTP_HOST is configured (works with Gmail app passwords,
 * Resend, Amazon SES, Brevo, Zoho, etc.).
 * WhatsApp: not available yet; phone-number logins get a clear error.
 * Local development without SMTP: OTP_DEV_MODE=true logs the code to the server console.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  readonly devMode: boolean;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('EMAIL_FROM') || user || 'no-reply@localhost';

    // Dev mode is on by default outside production; it can never be on in production.
    this.devMode = process.env.NODE_ENV !== 'production'
      && this.config.get<string>('OTP_DEV_MODE') !== 'false';

    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: user ? { user, pass } : undefined,
        })
      : null;

    this.logger.log(this.transporter
      ? `OTP email delivery via SMTP ${host}:${port}.`
      : this.devMode
        ? 'OTP_DEV_MODE: codes are logged to the console, no email is sent.'
        : 'SMTP is not configured: email OTP delivery is unavailable.');
  }

  get emailConfigured(): boolean {
    return Boolean(this.transporter);
  }

  async sendOtp(contact: string, code: string): Promise<void> {
    if (!contact.includes('@')) {
      throw new ServiceUnavailableException(
        'WhatsApp codes are not available yet. Please sign in with your email address.',
      );
    }

    if (!this.transporter) {
      if (this.devMode) {
        this.logger.warn(`[OTP_DEV_MODE] Code for ${contact}: ${code}`);
        return;
      }
      throw new ServiceUnavailableException('Email delivery is not configured. Please try again later.');
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: contact,
        subject: `${code} is your Travelogue sign-in code`,
        text: `Your Travelogue sign-in code is ${code}.\n\nIt expires in 5 minutes. If you didn't request it, you can ignore this email.`,
        html: `<div style="font-family:sans-serif;font-size:15px;color:#111">
  <p>Your Travelogue sign-in code is:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
  <p>It expires in 5 minutes. If you didn't request it, you can ignore this email.</p>
</div>`,
      });
    } catch (error) {
      this.logger.error(`OTP email to ${contact} failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('We could not send the code right now. Please try again shortly.');
    }
  }
}
