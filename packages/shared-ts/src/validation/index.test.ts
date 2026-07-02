import { describe, expect, it } from 'bun:test';

import {
  MAX_AUDIO_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  attachmentMetadataSchema,
  emailSchema,
  fullNameSchema,
  registrationSchema,
} from './index';

describe('shared-ts/validation', () => {
  describe('emailSchema', () => {
    it('accepts valid emails', () => {
      expect(emailSchema.safeParse('user@example.com').success).toBe(true);
      expect(emailSchema.safeParse('user.name@domain.co.uk').success).toBe(true);
    });

    it('rejects invalid emails', () => {
      expect(emailSchema.safeParse('not-an-email').success).toBe(false);
      expect(emailSchema.safeParse('@missing-local.com').success).toBe(false);
      expect(emailSchema.safeParse('missing@domain').success).toBe(false);
    });
  });

  describe('fullNameSchema', () => {
    it('accepts valid full names', () => {
      expect(fullNameSchema.safeParse('John Doe').success).toBe(true);
      expect(fullNameSchema.safeParse('Jane').success).toBe(true);
    });

    it('rejects empty or whitespace-only names', () => {
      expect(fullNameSchema.safeParse('').success).toBe(false);
      expect(fullNameSchema.safeParse('   ').success).toBe(false);
    });

    it('rejects names longer than 128 characters', () => {
      const result = fullNameSchema.safeParse('a'.repeat(129));
      expect(result.success).toBe(false);
    });

    it('trims whitespace', () => {
      const result = fullNameSchema.safeParse('  John Doe  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('John Doe');
      }
    });
  });

  describe('registrationSchema', () => {
    it('validates complete registration input', () => {
      const result = registrationSchema.safeParse({
        email: 'John@Example.com',
        full_name: 'John Doe',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('john@example.com'); // lowercased
      }
    });

    it('rejects incomplete registration input', () => {
      const result = registrationSchema.safeParse({
        email: 'john@example.com',
        // missing full_name
      });

      expect(result.success).toBe(false);
    });
  });

  describe('attachmentMetadataSchema', () => {
    it('accepts attachments at the tier-specific size limits', () => {
      expect(
        attachmentMetadataSchema.safeParse({
          name: 'photo.png',
          size: MAX_IMAGE_SIZE_BYTES,
          mimeType: 'image/png',
        }).success
      ).toBe(true);
      expect(
        attachmentMetadataSchema.safeParse({
          name: 'clip.mp4',
          size: MAX_VIDEO_SIZE_BYTES,
          mimeType: 'video/mp4',
        }).success
      ).toBe(true);
      expect(
        attachmentMetadataSchema.safeParse({
          name: 'voice.m4a',
          size: MAX_AUDIO_SIZE_BYTES,
          mimeType: 'audio/mp4',
        }).success
      ).toBe(true);
      expect(
        attachmentMetadataSchema.safeParse({
          name: 'brief.pdf',
          size: MAX_DOCUMENT_SIZE_BYTES,
          mimeType: 'application/pdf',
        }).success
      ).toBe(true);
    });

    it('rejects empty attachments and files above their tier-specific limits', () => {
      const empty = attachmentMetadataSchema.safeParse({
        name: 'empty.txt',
        size: 0,
        mimeType: 'text/plain',
      });
      expect(empty.success).toBe(false);

      const image = attachmentMetadataSchema.safeParse({
        name: 'large-photo.png',
        size: MAX_IMAGE_SIZE_BYTES + 1,
        mimeType: 'IMAGE/PNG',
      });
      expect(image.success).toBe(false);
      expect(image.error?.issues[0]?.message).toBe('Image exceeds maximum size of 10MB');

      const video = attachmentMetadataSchema.safeParse({
        name: 'large-video.mp4',
        size: MAX_VIDEO_SIZE_BYTES + 1,
        mimeType: 'video/mp4',
      });
      expect(video.success).toBe(false);
      expect(video.error?.issues[0]?.message).toBe('Video exceeds maximum size of 100MB');

      const audio = attachmentMetadataSchema.safeParse({
        name: 'large-audio.m4a',
        size: MAX_AUDIO_SIZE_BYTES + 1,
        mimeType: 'audio/mp4',
      });
      expect(audio.success).toBe(false);
      expect(audio.error?.issues[0]?.message).toBe('Audio exceeds maximum size of 20MB');

      const document = attachmentMetadataSchema.safeParse({
        name: 'large-doc.pdf',
        size: MAX_DOCUMENT_SIZE_BYTES + 1,
        mimeType: 'application/pdf',
      });
      expect(document.success).toBe(false);
      expect(document.error?.issues[0]?.message).toBe('File exceeds maximum size of 20MB');
    });
  });
});
