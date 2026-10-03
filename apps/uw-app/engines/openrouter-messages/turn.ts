import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { z } from 'zod';
import type { VerbName } from '@uw/contracts';
import {
  notWiredCall,
  ProviderMismatchError,
  ToolOutsideToolsetError,
  type ModelEngine,
  type StopReason,
  type ToolCall,
  type TurnMessage,
  type TurnRequest,
  type TurnResult,
} from '@uw/harness';
import type { EngineConfig } from '../config.ts';
import { toolSchema } from '../tool-schemas.ts';

type OpenRouterBody = ChatCompletionCreateParamsNonStreaming & {
  readonly provider?: { readonly order: readonly string[]; readonly allow_fallbacks: false };
  readonly usage: { readonly include: true };
};

const MICROS_PER_UNIT = 1_000_000;
const NO_PIN = 'none';
const nonAlphanumeric = /[^a-z0-9]/gu;

const finishReasons: ReadonlyMap<string, StopReason> = new Map([
  ['stop', 'end_turn'],
  ['tool_calls', 'tool_use'],
  ['length', 'max_tokens'],
  ['content_filter', 'refused'],
]);

const servedBy = z.string();
const reportedCost = z.number().nonnegative();

function clientOf(config: EngineConfig): OpenAI | null {
  const account = config.AI_GATEWAY_ACCOUNT_ID;
  const gateway = config.AI_GATEWAY_ID;
  const apiKey = config.OPENROUTER_API_KEY;
  if (!account || !gateway || !apiKey) return null;
  const token = config.AI_GATEWAY_TOKEN;
  return new OpenAI({
    apiKey,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/openrouter/v1`,
    organization: null,
    project: null,
    fetch: config.fetch,
    defaultHeaders: token ? { 'cf-aig-authorization': `Bearer ${token}` } : {},
    maxRetries: 0,
  });
}

function messageOf(message: TurnMessage): ChatCompletionMessageParam {
  if (message.role === 'user') return { role: 'user', content: message.text };
  if (message.role === 'tool') {
    const output = message.isError ? { error: message.output ?? null } : (message.output ?? null);
    return { role: 'tool', tool_call_id: message.callId, content: JSON.stringify(output) };
  }
  const calls = message.toolCalls.map((call) => ({
    id: call.callId,
    type: 'function' as const,
    function: { name: call.verb, arguments: JSON.stringify(call.input ?? {}) },
  }));
  return {
    role: 'assistant',
    content: message.text,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
}

function historyOf(request: TurnRequest): ChatCompletionMessageParam[] {
  const called = new Set<string>();
  for (const message of request.messages) {
    if (message.role === 'assistant') message.toolCalls.forEach((call) => called.add(call.callId));
    if (message.role === 'tool' && !called.has(message.callId)) {
      throw new Error(`tool result ${message.callId} answers no earlier tool call`);
    }
  }
  return [{ role: 'system', content: request.instructions }, ...request.messages.map(messageOf)];
}

function toolsOf(verbs: readonly VerbName[]): ChatCompletionTool[] {
  return verbs.map(toolSchema).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

function bodyOf(request: TurnRequest): OpenRouterBody {
  const pin = request.pinnedProvider;
  return {
    model: request.model,
    messages: historyOf(request),
    tools: toolsOf(request.tools),
    tool_choice: 'auto',
    ...(pin === null ? {} : { provider: { order: [pin], allow_fallbacks: false } }),
    usage: { include: true },
  };
}

function argumentsOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function callsOf(reply: ChatCompletion, offered: readonly VerbName[]): ToolCall[] {
  const calls = reply.choices[0]?.message.tool_calls ?? [];
  return calls.map((call) => {
    const name = call.type === 'function' ? call.function.name : call.custom.name;
    const verb = offered.find((offeredName) => offeredName === name);
    if (verb === undefined || call.type !== 'function') throw new ToolOutsideToolsetError(name);
    return { callId: call.id, verb, input: argumentsOf(call.function.arguments) };
  });
}

function comparable(provider: string): string {
  return provider.normalize('NFKC').toLowerCase().replace(nonAlphanumeric, '');
}

function resolvedProvider(served: string | undefined, pin: string | null): string {
  const resolved = served?.normalize('NFKC').trim().toLowerCase() ?? '';
  if (resolved === '') throw new ProviderMismatchError(pin ?? NO_PIN, null);
  if (pin === null) return resolved;
  if (comparable(resolved) !== comparable(pin)) throw new ProviderMismatchError(pin, resolved);
  return pin;
}

function usageOf(reply: ChatCompletion): TurnResult['usage'] {
  const cost = reportedCost.safeParse(Reflect.get(reply.usage ?? {}, 'cost')).data;
  return {
    inputTokens: reply.usage?.prompt_tokens ?? 0,
    outputTokens: reply.usage?.completion_tokens ?? 0,
    costMicros: cost === undefined ? null : Math.round(cost * MICROS_PER_UNIT),
    costBasis: 'metered',
  };
}

function stopOf(reply: ChatCompletion): StopReason {
  return finishReasons.get(reply.choices[0]?.finish_reason ?? '') ?? 'refused';
}

function resultFrom(reply: ChatCompletion, request: TurnRequest): TurnResult {
  const served = servedBy.safeParse(Reflect.get(reply, 'provider'));
  const provider = resolvedProvider(served.data, request.pinnedProvider);
  return {
    toolCalls: callsOf(reply, request.tools),
    text: reply.choices[0]?.message.content ?? null,
    stopReason: stopOf(reply),
    usage: usageOf(reply),
    resolvedProvider: provider,
    resolvedModel: reply.model,
  };
}

export function openrouterMessagesTurn(config: EngineConfig): ModelEngine['turn'] {
  const client = clientOf(config);
  if (client === null) return () => notWiredCall('modelEngine', 'turn');
  return async (request) => {
    const reply = await client.chat.completions.create(bodyOf(request));
    return resultFrom(reply, request);
  };
}
