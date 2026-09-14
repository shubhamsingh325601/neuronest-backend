import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicianApplicationStatus, Role, UserStatus } from '@prisma/client';
import type { AppConfig } from '@common/config/configuration';
import { EmailService } from '@common/email/email.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';
import { ApproveApplicationResponseDto } from './dto/approve-application.response.dto';

/**
 * Admin approves a clinician application: provision an auth-anchor `User`
 * (`role=CLINICIAN`, `status=INVITED`, no password) and email an account-setup link.
 * The application moves to `APPROVED`.
 *
 * - Missing → 404 `APPLICATION_NOT_FOUND`.
 * - Already `REJECTED` → 409 `APPLICATION_DECISION_FINAL` (a decision reversal is not
 *   an implicit side effect of this endpoint).
 * - Already `APPROVED` → idempotent no-op: no second `User`, no second email. Protects
 *   the one action in this flow with real side effects from a double-click / retry.
 * - A `User` with the application's email already exists → 409 `EMAIL_ALREADY_REGISTERED`,
 *   application status left untouched for the admin to resolve manually.
 */
@Injectable()
export class ApproveApplicationService {
  private readonly appWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly email: EmailService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.appWebUrl = config.get('appWebUrl', { infer: true });
  }

  async approve(id: string): Promise<ApproveApplicationResponseDto> {
    const application = await this.prisma.clinicianApplication.findUnique({ where: { id } });
    if (!application) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'No clinician application with that id.',
      });
    }

    if (application.status === ClinicianApplicationStatus.REJECTED) {
      throw new ConflictException({
        code: 'APPLICATION_DECISION_FINAL',
        message: 'This application was already rejected; reversing that is a manual step.',
      });
    }

    const email = application.email.toLowerCase().trim();

    if (application.status === ClinicianApplicationStatus.APPROVED) {
      const already = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      return {
        application: ClinicianApplicationDto.from(application),
        clinicianUserId: already?.id ?? null,
      };
    }

    // status is PENDING or REVIEWED — still open.
    const clash = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A user with this email already exists — resolve it manually before approving.',
      });
    }

    const [user, updated] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          email,
          name: application.name,
          role: Role.CLINICIAN,
          status: UserStatus.INVITED,
          passwordHash: null,
          emailVerifiedAt: null,
        },
        select: { id: true, email: true },
      }),
      this.prisma.clinicianApplication.update({
        where: { id },
        data: { status: ClinicianApplicationStatus.APPROVED },
      }),
    ]);

    const token = await this.verificationTokens.issueAccountSetupToken(user.id);
    const setupUrl = `${this.appWebUrl.replace(/\/$/, '')}/complete-account-setup?token=${encodeURIComponent(token)}`;
    await this.email.sendAccountSetupLink(user.email, setupUrl);

    return {
      application: ClinicianApplicationDto.from(updated),
      clinicianUserId: user.id,
    };
  }
}
