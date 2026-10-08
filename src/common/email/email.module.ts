import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEmailService } from './email-provider.factory';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [{ provide: EmailService, useFactory: createEmailService, inject: [ConfigService] }],
  exports: [EmailService],
})
export class EmailModule {}
