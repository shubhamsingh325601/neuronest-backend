import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import { stdTimeFunctions } from 'pino';

export interface HttpLogSettings {
  level: string;
  format: 'pretty' | 'json';
  /** Deployment label stamped on every line, so logs from staging and production never blur together. */
  appEnv: string;
}

/** Polled by uptime monitors every few seconds; logged at debug so it does not bury real traffic. */
const QUIET_PATHS = new Set(['/v1/health']);

/** Fields every log line inside a request is correlated by. Never the headers: they are 1.5 KB of noise. */
const REQUEST_FIELDS = (req: IncomingMessage, status: number, ms: number): Record<string, unknown> => ({
  method: req.method,
  path: pathOf(req),
  statusCode: status,
  ms,
  ip: clientIp(req),
  ua: truncate(headerOf(req, 'user-agent'), 80),
});

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The URL without its query string: query values can carry tokens and add nothing to tracing. */
function pathOf(req: IncomingMessage): string {
  const url = req.url ?? '';
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

/** The caller behind Cloudflare/Render: their proxies put the real address first. */
function clientIp(req: IncomingMessage): string | undefined {
  return (
    headerOf(req, 'cf-connecting-ip') ??
    headerOf(req, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress
  );
}

function truncate(value: string | undefined, max: number): string | undefined {
  return value && value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * pino-http settings for one clean line per request.
 *
 * Every line written while a request is handled carries only `reqId` (plus `userId`/`role` once the
 * caller is authenticated); the completion line adds method, path, status, duration and client. Pair
 * that with the `x-request-id` header/`requestId` in error bodies and one id traces a request end to end.
 *
 *   pretty: 17:11:12.882 INFO  [AiRunRecorder] 30a1e3dd-… ai run {"capability":"chat-reply",...}
 *           17:11:12.884 INFO  30a1e3dd-… POST /v1/ai-conversations/…/messages 200 2634ms {"userId":…}
 */
export function buildHttpLogOptions(settings: HttpLogSettings): Options {
  return {
    level: settings.level,
    base: { env: settings.appEnv },
    timestamp: stdTimeFunctions.isoTime,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Child loggers carry `{ reqId }` instead of the whole serialized request and response.
    quietReqLogger: true,
    quietResLogger: true,
    customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (QUIET_PATHS.has(pathOf(req))) return 'debug';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res, ms) =>
      `${req.method} ${pathOf(req)} ${res.statusCode} ${ms}ms`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode} failed`,
    customSuccessObject: (req, res, val) => REQUEST_FIELDS(req, res.statusCode, val.responseTime),
    customErrorObject: (req, res, err, val) => ({
      ...REQUEST_FIELDS(req, res.statusCode, val.responseTime),
      errorMessage: err.message,
    }),
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.newPassword',
      'req.body.token',
      'req.body.refreshToken',
      'req.body.code',
      '*.password',
      '*.passwordHash',
      '*.newPassword',
      '*.token',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
    ],
    transport:
      settings.format === 'pretty'
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: Boolean(process.stdout.isTTY),
              translateTime: 'SYS:HH:MM:ss.l',
              // Shown through messageFormat or already in the message; the rest prints after it.
              ignore: 'pid,hostname,env,context,reqId,method,path,statusCode,ms',
              messageFormat: '{if context}[{context}] {end}{if reqId}{reqId} {end}{msg}',
            },
          }
        : undefined,
  };
}
