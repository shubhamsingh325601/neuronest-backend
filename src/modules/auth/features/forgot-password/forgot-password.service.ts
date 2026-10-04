import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthEmailJobs } from '@modules/auth/jobs/auth-email.jobs';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Injectable()
export class ForgotPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailJobs: AuthEmailJobs,
  ) {}

  /** Always resolves — the endpoint responds 202 no matter what, so it cannot be
   *  used to discover which email addresses have accounts. The send is queued, so a
   *  mail-provider failure never reaches the caller (it used to 500 only when the account
   *  existed — an enumeration oracle). */
  async requestReset(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    await this.emailJobs.enqueuePasswordReset(this.prisma, user.id);
    await this.emailJobs.kick();
  }
}
