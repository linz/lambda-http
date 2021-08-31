import { Metrics } from '@linzjs/metrics';
import { Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { LogType } from './log';
import { LambdaResponse } from './response';

export function isRecord(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object') return false;
  if (x == null) return false;
  return true;
}

export class LambdaRequest<T = unknown, K = unknown> {
  public event: T;
  public context: Context;
  public id: string;
  public logContext: Record<string, unknown> = {};
  public timer: Metrics = new Metrics();
  public headers = new Map<string, string>();
  public log: LogType;

  constructor(event: T, ctx: Context, log: LogType) {
    this.context = ctx;
    this.event = event;

    this.id = ulid();
    this.log = log;
    this.timer = new Metrics();
    this.log = log.child({ id: this.id, aws: { lambdaId: ctx.awsRequestId } });
  }

  /** Set a logging context, this will be logged at the end of the request */
  set(key: string, value: unknown): void {
    if (value == null) value = undefined;
    this.logContext[key] = value;
  }

  toResponse(res: LambdaResponse | void): K {
    return res?.body as unknown as K;
  }
}
