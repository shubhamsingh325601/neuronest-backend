import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { AppConfig } from '@common/config/configuration';

/** Thin wrapper over argon2id so hashing parameters live in one config-driven place. */
@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions;

  constructor(config: ConfigService<AppConfig, true>) {
    const params = config.get('argon2', { infer: true });
    this.options = {
      type: argon2.argon2id,
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
    };
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
