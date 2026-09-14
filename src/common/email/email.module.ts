import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ResendEmailService } from './resend-email.service';

@Global()
@Module({
  providers: [{ provide: EmailService, useClass: ResendEmailService }],
  exports: [EmailService],
})
export class EmailModule {}
