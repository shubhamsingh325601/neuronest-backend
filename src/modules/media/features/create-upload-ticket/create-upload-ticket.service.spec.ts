import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MediaType } from '@prisma/client';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateUploadTicketService } from './create-upload-ticket.service';

describe('CreateUploadTicketService', () => {
  const prisma = { child: { findUnique: jest.fn() }, media: { create: jest.fn() } };
  const mediaStorage = { createUploadTicket: jest.fn(), verifyUpload: jest.fn() };
  let service: CreateUploadTicketService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateUploadTicketService,
        { provide: PrismaService, useValue: prisma },
        { provide: MediaStorageService, useValue: mediaStorage },
      ],
    }).compile();
    service = moduleRef.get(CreateUploadTicketService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.create('child-1', 'parent-1', { type: MediaType.PHOTO })).rejects.toThrow(
      NotFoundException,
    );
    expect(mediaStorage.createUploadTicket).not.toHaveBeenCalled();
  });

  it("forbids a caller who is not the child's parent", async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    await expect(service.create('child-1', 'parent-2', { type: MediaType.PHOTO })).rejects.toThrow(
      ForbiddenException,
    );
    expect(mediaStorage.createUploadTicket).not.toHaveBeenCalled();
  });

  it('mints a ticket and records a PENDING media row for the owning parent', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    mediaStorage.createUploadTicket.mockResolvedValue({
      storageKey: 'fake/child-1/some-id',
      uploadParams: { fake: true },
    });
    prisma.media.create.mockResolvedValue({
      id: 'media-1',
      childId: 'child-1',
      uploadedById: 'parent-1',
      type: MediaType.PHOTO,
      provider: 'CLOUDINARY',
      storageKey: 'fake/child-1/some-id',
      status: 'PENDING',
      mimeType: null,
      durationSeconds: null,
      sizeBytes: null,
      context: 'first steps',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('child-1', 'parent-1', {
      type: MediaType.PHOTO,
      context: 'first steps',
    });

    expect(mediaStorage.createUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({ childId: 'child-1', type: MediaType.PHOTO }),
    );
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          childId: 'child-1',
          uploadedById: 'parent-1',
          type: MediaType.PHOTO,
          storageKey: 'fake/child-1/some-id',
          context: 'first steps',
        }),
      }),
    );
    expect(result.media.id).toBe('media-1');
    expect(result.uploadParams).toEqual({ fake: true });
  });
});
