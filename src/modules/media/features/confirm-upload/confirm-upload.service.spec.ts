import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MediaStatus, MediaType } from '@prisma/client';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConfirmUploadService } from './confirm-upload.service';

describe('ConfirmUploadService', () => {
  const prisma = { media: { findUnique: jest.fn(), update: jest.fn() } };
  const mediaStorage = {
    createUploadTicket: jest.fn(),
    inspectUpload: jest.fn(),
    createPlaybackUrl: jest.fn(),
  };
  let service: ConfirmUploadService;

  const pendingMedia = {
    id: 'media-1',
    childId: 'child-1',
    uploadedById: 'parent-1',
    type: MediaType.PHOTO,
    provider: 'CLOUDINARY',
    storageKey: 'fake/child-1/media-1',
    status: MediaStatus.PENDING,
    mimeType: null,
    durationSeconds: null,
    sizeBytes: null,
    context: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    child: { parentId: 'parent-1' },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfirmUploadService,
        { provide: PrismaService, useValue: prisma },
        { provide: MediaStorageService, useValue: mediaStorage },
      ],
    }).compile();
    service = moduleRef.get(ConfirmUploadService);
  });

  it('404s when the media does not exist', async () => {
    prisma.media.findUnique.mockResolvedValue(null);
    await expect(
      service.confirm('missing', 'parent-1', { status: MediaStatus.UPLOADED }),
    ).rejects.toThrow(NotFoundException);
  });

  it("forbids a caller who is not the child's parent", async () => {
    prisma.media.findUnique.mockResolvedValue(pendingMedia);
    await expect(
      service.confirm('media-1', 'parent-2', { status: MediaStatus.UPLOADED }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('persists provider-reported metadata and ignores the client-supplied body', async () => {
    prisma.media.findUnique.mockResolvedValue(pendingMedia);
    mediaStorage.inspectUpload.mockResolvedValue({
      bytes: 4096,
      format: 'jpg',
      mimeType: 'image/jpeg',
      durationSeconds: null,
    });
    mediaStorage.createPlaybackUrl.mockResolvedValue({
      url: 'https://cdn.example.com/media-1',
      expiresAt: null,
    });
    prisma.media.update.mockImplementation(({ data }) => Promise.resolve({ ...pendingMedia, ...data }));

    const result = await service.confirm('media-1', 'parent-1', {
      status: MediaStatus.UPLOADED,
      mimeType: 'video/forged',
      sizeBytes: 1,
      durationSeconds: 99999,
    });

    expect(mediaStorage.inspectUpload).toHaveBeenCalledWith('fake/child-1/media-1', MediaType.PHOTO);
    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: {
        status: MediaStatus.UPLOADED,
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
        durationSeconds: null,
      },
    });
    expect(result.status).toBe(MediaStatus.UPLOADED);
    expect(result.playbackUrl).toBe('https://cdn.example.com/media-1');
  });

  it('rejects UPLOADED when the provider has no asset at that key', async () => {
    prisma.media.findUnique.mockResolvedValue(pendingMedia);
    mediaStorage.inspectUpload.mockResolvedValue(null);

    await expect(
      service.confirm('media-1', 'parent-1', { status: MediaStatus.UPLOADED }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('marks FAILED without inspecting the provider, storing null metadata', async () => {
    prisma.media.findUnique.mockResolvedValue(pendingMedia);
    prisma.media.update.mockResolvedValue({ ...pendingMedia, status: MediaStatus.FAILED });

    const result = await service.confirm('media-1', 'parent-1', {
      status: MediaStatus.FAILED,
      mimeType: 'image/png',
      sizeBytes: 5,
    });

    expect(mediaStorage.inspectUpload).not.toHaveBeenCalled();
    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: { status: MediaStatus.FAILED, mimeType: null, sizeBytes: null, durationSeconds: null },
    });
    expect(result.status).toBe(MediaStatus.FAILED);
  });

  it('re-confirming the same terminal status is an idempotent no-op', async () => {
    const uploaded = { ...pendingMedia, status: MediaStatus.UPLOADED };
    prisma.media.findUnique.mockResolvedValue(uploaded);
    mediaStorage.createPlaybackUrl.mockResolvedValue({
      url: 'https://cdn.example.com/media-1',
      expiresAt: null,
    });

    const result = await service.confirm('media-1', 'parent-1', { status: MediaStatus.UPLOADED });

    expect(prisma.media.update).not.toHaveBeenCalled();
    expect(mediaStorage.inspectUpload).not.toHaveBeenCalled();
    expect(result.status).toBe(MediaStatus.UPLOADED);
    expect(result.playbackUrl).toBe('https://cdn.example.com/media-1');
  });

  it('re-confirming a conflicting terminal status is a 409', async () => {
    const uploaded = { ...pendingMedia, status: MediaStatus.UPLOADED };
    prisma.media.findUnique.mockResolvedValue(uploaded);

    await expect(
      service.confirm('media-1', 'parent-1', { status: MediaStatus.FAILED }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.media.update).not.toHaveBeenCalled();
  });
});
