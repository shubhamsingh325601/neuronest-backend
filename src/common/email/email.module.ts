import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackUrlService } from './callback-url.service';
import { createEmailService } from './email-provider.factory';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [
    { provide: EmailService, useFactory: createEmailService, inject: [ConfigService] },
    CallbackUrlService,
  ],
  exports: [EmailService, CallbackUrlService],
})
export class EmailModule {}
