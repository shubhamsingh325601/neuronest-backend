import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { STATUS_CODES } from 'node:http';

/** Base URI for the RFC 9457 `type` member. Need not resolve to a live page. */
const PROBLEM_TYPE_BASE = 'https://docs.neuronest.dev/problems';
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

interface NormalisedError {
  statusCode: number;
  error: string;
  message: string | string[];
  code: string;
}

/**
 * Catches everything and emits the single {@link ProblemDetailsDto} shape —
 * [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details, served as
 * `application/problem+json`.
 * - `HttpException` passes through, honouring a `code` field if the thrower supplied one.
 * - Known Prisma errors are mapped (P2002 unique -> 409, P2025 not found -> 404).
 * - Anything else becomes a 500 and is reported to Sentry.
 *
 * `code`, `requestId`, `timestamp` (and `errors` for validation failures) are RFC 9457
 * extension members — the previous custom shape is repackaged, not reduced.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const normalised = this.normalise(exception);

    if (normalised.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      Sentry.captureException(exception);
      this.logger.error(
        { err: exception, path: request?.url },
        'Unhandled exception -> 500',
      );
    }

    const isValidationList = Array.isArray(normalised.message);
    const body: Record<string, unknown> = {
      type: `${PROBLEM_TYPE_BASE}/${this.kebabCode(normalised.code)}`,
      title: this.titleFromCode(normalised.code),
      status: normalised.statusCode,
      detail: isValidationList
        ? (normalised.message as string[]).join('; ')
        : (normalised.message as string),
      instance: httpAdapter.getRequestUrl(request),
      code: normalised.code,
      requestId: request?.id ?? request?.headers?.['x-request-id'] ?? null,
      timestamp: new Date().toISOString(),
    };
    if (isValidationList) {
      body.errors = normalised.message;
    }

    httpAdapter.setHeader(response, 'Content-Type', PROBLEM_CONTENT_TYPE);
    httpAdapter.reply(response, body, normalised.statusCode);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return {
          statusCode: status,
          error: STATUS_CODES[status] ?? 'Error',
          message: res,
          code: this.defaultCode(status),
        };
      }

      const obj = res as Record<string, unknown>;
      return {
        statusCode: status,
        error: (obj.error as string) ?? STATUS_CODES[status] ?? 'Error',
        message: (obj.message as string | string[]) ?? exception.message,
        code: (obj.code as string) ?? this.defaultCode(status),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'A record with these unique fields already exists.',
          code: 'UNIQUE_CONSTRAINT',
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'The requested record was not found.',
          code: 'NOT_FOUND',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR',
    };
  }

  private defaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'ERROR';
    }
  }

  /** `INVALID_CREDENTIALS` -> `invalid-credentials`, for the `type` URI. */
  private kebabCode(code: string): string {
    return code.toLowerCase().replace(/_/g, '-');
  }

  /** `INVALID_CREDENTIALS` -> `Invalid Credentials`. One static title per code. */
  private titleFromCode(code: string): string {
    return code
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
