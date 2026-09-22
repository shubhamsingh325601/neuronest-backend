import { Global, Module } from '@nestjs/common';
import { CloudinaryMediaStorageService } from './cloudinary-media-storage.service';
import { MediaStorageService } from './media-storage.service';

@Global()
@Module({
  providers: [{ provide: MediaStorageService, useClass: CloudinaryMediaStorageService }],
  exports: [MediaStorageService],
})
export class MediaStorageModule {}
