import { Injectable, BadRequestException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import * as crypto from 'crypto';
import { normalizeContact } from '../common/contact';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly notifications: NotificationService,
  ) {}

  private hashOtp(code: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(code).digest('hex');
  }

  async sendOtp(dto: SendOtpDto) {
    const contact = normalizeContact(dto.contact);
    
    // Validate format: email or 10-digit mobile
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const cleanPhone = contact.replace(/\D/g, '');
    const isPhone = cleanPhone.length >= 10;

    if (!isEmail && !isPhone) {
      throw new BadRequestException('Please enter a valid email address or 10-digit mobile number.');
    }

    // Rate limiting: max 5 requests in last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentOtps = await this.prisma.otpCode.count({
      where: {
        contact,
        createdAt: { gte: tenMinutesAgo },
      },
    });

    if (recentOtps >= 5) {
      throw new BadRequestException('Too many OTP requests. Please wait a few minutes before trying again.');
    }
    // Fixed code only for local development without email; everywhere else a random 6-digit code.
    const useFixedDevCode = this.notifications.devMode && !this.notifications.emailConfigured;
    const code = useFixedDevCode
      ? '123456'
      : crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

    const salt = process.env.OTP_SECRET || process.env.JWT_SECRET
      || (process.env.NODE_ENV === 'production' ? '' : 'travelogue_local_otp_secret');
    if (!salt) {
      throw new Error('OTP_SECRET must be configured in production.');
    }
    const codeHash = this.hashOtp(code, salt);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    // Store in database, then deliver; remove the code again if delivery fails.
    const otp = await this.prisma.otpCode.create({
      data: {
        contact,
        codeHash,
        expiresAt,
      },
    });
    try {
      await this.notifications.sendOtp(contact, code);
    } catch (error) {
      await this.prisma.otpCode.delete({ where: { id: otp.id } }).catch(() => undefined);
      throw error;
    }

    // Save user draft name if provided
    if (dto.name) {
      const existing = await this.prisma.user.findUnique({ where: { contact } });
      if (!existing) {
        await this.prisma.user.create({
          data: { contact, name: dto.name.trim() },
        });
      } else if (!existing.name) {
        await this.prisma.user.update({
          where: { contact },
          data: { name: dto.name.trim() },
        });
      }
    }

    return {
      success: true,
      message: useFixedDevCode
        ? `Local development only: no message was sent. Enter code ${code} for ${contact}.`
        : `We sent a 6-digit code to ${contact}. Check your inbox and spam folder.`,
      contact,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const contact = normalizeContact(dto.contact);
    const code = dto.code.trim();

    // Validate the newest unexpired code and limit failed attempts.
    const salt = process.env.OTP_SECRET || process.env.JWT_SECRET
      || (process.env.NODE_ENV === 'production' ? '' : 'travelogue_local_otp_secret');
    if (!salt) {
      throw new Error('OTP_SECRET must be configured in production.');
    }
    const codeHash = this.hashOtp(code, salt);

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        contact,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord || otpRecord.attempts >= 5) {
      throw new UnauthorizedException('That code is not correct or has expired. Please check and try again.');
    }

    const provided = Buffer.from(codeHash, 'hex');
    const expected = Buffer.from(otpRecord.codeHash, 'hex');
    const isValid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    if (!isValid) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('That code is not correct or has expired. Please check and try again.');
    }

    // Find or create User
    let user = await this.prisma.user.findUnique({ where: { contact } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          contact,
          name: contact.includes('@') ? contact.split('@')[0] : 'User',
        },
      });

    }

    // Ensure users created during signup also receive the default views.
    const existingViews = await this.prisma.view.count({ where: { userId: user.id } });
    if (existingViews === 0) {
      const defaultViews = ['Mumbai Client Visit', 'Q4 Team Offsite', 'Monthly Office', 'Personal'];
      await this.prisma.view.createMany({
        data: defaultViews.map((name) => ({ name, userId: user.id })),
      });
    }

    await this.prisma.otpCode.deleteMany({ where: { contact } });

    // Generate JWT access token
    const payload = { sub: user.id, contact: user.contact };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        contact: user.contact,
      },
    };
  }
}
