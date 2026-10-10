import { Module } from '@nestjs/common';
import { StreamProbeController } from './stream-probe.controller';

/** TEMPORARY, see {@link StreamProbeController}. */
@Module({ controllers: [StreamProbeController] })
export class StreamProbeModule {}
