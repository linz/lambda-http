import { Callback, Context, Handler } from 'aws-lambda';
import pino from 'pino';
import { LambdaResponse } from './response.js';
import { ApplicationJson, HttpHeader, HttpHeaderAmazon, HttpHeaderRequestId } from './header.js';
import { LogType } from './log.js';
import { LambdaRequest } from './request.js';
import { LambdaAlbRequest } from './request.alb.js';
import { LambdaApiGatewayRequest } from './request.api.gateway.js';
import { LambdaCloudFrontRequest } from './request.cloudfront.js';
import { HttpRequestEvent, HttpResponse, LambdaHttpRequest } from './request.http.js';
import { LambdaHttpResponse } from './response.http.js';
import { Router } from './router.js';

export interface HttpStatus {
  statusCode: string;
  statusDescription: string;
}

export type LambdaHandler<TEvent = unknown, TResult = unknown> = (
  event: TEvent,
  context: Context,
  callback: Callback<TResult>,
) => void;
export interface LambdaWrappedFunction<T, K = LambdaResponse | void> {
  (req: LambdaRequest<T>): K | Promise<K>;
}
export type LambdaWrappedFunctionHttp = (req: LambdaHttpRequest) => LambdaHttpResponse | Promise<LambdaHttpResponse>;
export type LambdaHttpFunc = Handler<HttpRequestEvent, HttpResponse>;

const version = process.env.GIT_VERSION;
const hash = process.env.GIT_HASH;
const versionInfo = { version, hash };

/** Run the request catching any errors */
async function runFunction<T extends LambdaRequest, K>(
  req: T,
  fn: (req: T) => K | Promise<K>,
): Promise<K | LambdaHttpResponse> {
  try {
    return await fn(req);
  } catch (error) {
    // If a LambdaHttpResponse was thrown, just reuse it as a response
    if (LambdaHttpResponse.is(error)) return error;

    // Unhandled exception was thrown
    req.set('err', error);
    return new LambdaHttpResponse(500, 'Internal Server Error');
  }
}

export async function execute<T extends LambdaRequest, K>(
  req: T,
  fn: (req: T) => K | Promise<K>,
): Promise<K | LambdaHttpResponse> {
  req.timer.start('lambda');

  const res = await runFunction(req, fn);

  let status = 200;
  if (LambdaHttpResponse.is(res)) {
    status = res.status;
    req.set('description', res.statusDescription);
  }

  req.set('status', status);
  req.set('metrics', req.timer.metrics);

  if (versionInfo.hash) req.set('package', versionInfo);

  const duration = req.timer.end('lambda');
  req.set('unfinished', req.timer.unfinished);
  req.set('duration', duration);

  // // Log a "Report" or "Metalog" full of information at the end of every request
  req.set('@type', 'report');

  if (status > 499) req.log.error(req.logContext, 'Lambda:Done');
  else if (status > 399) req.log.warn(req.logContext, 'Lambda:Done');
  else req.log.info(req.logContext, 'Lambda:Done');

  return res;
}

interface LambdaHandlerOptions {
  /**
   * Should errors be handled and logged or reject the callback
   * @default true
   */
  rejectOnError: boolean;

  /**
   * Percentage of requests to be set to `trace` level logging.
   * Number between 0 and 1, 1 meaning all requests are traced
   * @default 0
   */
  tracePercent: number;
}

function addDefaultOptions(o?: Partial<LambdaHandlerOptions>): LambdaHandlerOptions {
  const opts = {
    rejectOnError: true,
    tracePercent: 0,
    ...o,
  };
  if (isNaN(opts.tracePercent) || opts.tracePercent > 1) {
    throw new Error('tracePercent is not between 0-1 :' + opts.tracePercent);
  }
  return opts;
}

export class lf {
  /** Default logger to use if one is not provided */
  static Logger: LogType = pino();
  /**
   * Set the http "Server" header to include this name
   * Setting to null or '' will not set the Server
   */
  static ServerName: string | null = 'linz';

  static request(req: HttpRequestEvent, ctx: Context, log: LogType): LambdaHttpRequest {
    if (LambdaAlbRequest.is(req)) return new LambdaAlbRequest(req, ctx, log);
    if (LambdaApiGatewayRequest.is(req)) return new LambdaApiGatewayRequest(req, ctx, log);
    if (LambdaCloudFrontRequest.is(req)) return new LambdaCloudFrontRequest(req, ctx, log);
    throw new Error('Request is not a a ALB, ApiGateway or Cloudfront event');
  }

  /**
   *  Wrap a lambda function to provide extra functionality
   *
   * - Log metadata about the call on every request
   * - Catch errors and log them before exiting
   *
   * @param fn Function to wrap
   * @param options Configuration options
   * @param logger optional logger to use for the request @see lf.Logger
   */
  public static handler<TEvent, TResult = unknown>(
    fn: LambdaWrappedFunction<TEvent>,
    options?: Partial<LambdaHandlerOptions>,
    logger?: LogType,
  ): LambdaHandler<TEvent, TResult> {
    const opts = addDefaultOptions(options);
    function handler(event: TEvent, context: Context, callback: Callback<TResult>): void {
      const req = new LambdaRequest<TEvent, TResult>(event, context, logger ?? lf.Logger);
      if (opts.tracePercent > 0 && Math.random() < opts.tracePercent) req.log.level = 'trace';
      if (process.env.TRACE_LAMBDA) req.log.level = 'trace';

      req.log.trace({ event }, 'Lambda:Start');

      const lambdaId = context.awsRequestId;
      req.set('aws', { lambdaId });

      execute(req, fn).then((res) => {
        if (opts.rejectOnError && LambdaHttpResponse.is(res)) {
          if (req.logContext['err']) return callback(req.logContext['err'] as Error);
          if (res.status > 399) return callback(req.toResponse(res) as unknown as string);
        }
        return callback(null, req.toResponse(res));
      });
    }
    return handler;
  }
  /**
   *  Create a route lambda function to provide extra functionality
   *
   * - Log metadata about the call on every request
   * - Catch errors and log them before exiting
   *
   * @param logger optional logger to use for the request @see lf.Logger
   */
  public static http(logger?: LogType): LambdaHandler<HttpRequestEvent, HttpResponse> & { router: Router } {
    const router = new Router();
    function httpHandler(event: HttpRequestEvent, context: Context, callback: Callback<HttpResponse>): void {
      const req = lf.request(event, context, logger ?? lf.Logger);

      // Trace cloudfront requests back to the cloudfront logs
      const cloudFrontId = req.header(HttpHeaderAmazon.CloudfrontId);
      const traceId = req.header(HttpHeaderAmazon.TraceId);
      const lambdaId = context.awsRequestId;
      req.set('aws', { cloudFrontId, traceId, lambdaId });
      req.set('method', req.method);
      req.set('path', req.path);

      router.handle(req).then((res: LambdaHttpResponse) => {
        // Do not cache http 500 errors
        if (res.status === 500) res.header(HttpHeader.CacheControl, 'no-store');
        res.header(HttpHeaderRequestId.RequestId, req.id);
        res.header(HttpHeaderRequestId.CorrelationId, req.correlationId);

        const duration = req.timer.metrics?.['lambda'];
        if (duration != null) res.header(HttpHeader.ServerTiming, `total;dur=${duration}`);

        if (!res.isBase64Encoded && res.header(HttpHeader.ContentType) == null) {
          res.header(HttpHeader.ContentType, ApplicationJson);
        }

        if (lf.ServerName) res.header(HttpHeader.Server, `${lf.ServerName}-${version}`);

        callback(null, req.toResponse(res));
      });
    }
    httpHandler.router = router;
    return httpHandler;
  }
}
