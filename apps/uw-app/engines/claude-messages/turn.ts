import Anthropic from '@anthropic-ai/sdk';
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
import { costMicrosOf } from './prices.ts';

const PROVIDER = 'anthropic';
const MAX_TOKENS = 4096;

type ToolResultBlock = Anthropic.ToolResultBlockParam;

const stopReasons: ReadonlyMap<string, StopReason> = new Map([
  ['end_turn', 'end_turn'],
  ['stop_sequence', 'end_turn'],
  ['tool_use', 'tool_use'],
  ['max_tokens', 'max_tokens'],
  ['refusal', 'refused'],
]);

function clientOf(config: EngineConfig): Anthropic | null {
  const account = config.AI_GATEWAY_ACCOUNT_ID;
  const gateway = config.AI_GATEWAY_ID;
  const apiKey = config.ANTHROPIC_API_KEY;
  if (!account || !gateway || !apiKey) return null;
  const token = config.AI_GATEWAY_TOKEN;
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/anthropic`,
    fetch: config.fetch,
    defaultHeaders: token ? { 'cf-aig-authorization': `Bearer ${token}` } : {},
    maxRetries: 0,
  });
}

function assistantOf(message: Extract<TurnMessage, { role: 'assistant' }>): Anthropic.MessageParam {
  const text: Anthropic.ContentBlockParam[] =
    message.text === null ? [] : [{ type: 'text', text: message.text }];
  const calls: Anthropic.ContentBlockParam[] = message.toolCalls.map((call) => ({
    type: 'tool_use',
    id: call.callId,
    name: call.verb,
    input: call.input,
  }));
  return { role: 'assistant', content: [...text, ...calls] };
}

function resultOf(message: Extract<TurnMessage, { role: 'tool' }>): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: message.callId,
    content: JSON.stringify(message.output ?? null),
    is_error: message.isError,
  };
}

function historyOf(messages: readonly TurnMessage[]): Anthropic.MessageParam[] {
  const history: Anthropic.MessageParam[] = [];
  const called = new Set<string>();
  let results: ToolResultBlock[] = [];
  const flush = () => {
    if (results.length > 0) history.push({ role: 'user', content: results });
    results = [];
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!called.has(message.callId)) {
        throw new Error(`tool result ${message.callId} answers no earlier tool call`);
      }
      results.push(resultOf(message));
      continue;
    }
    flush();
    if (message.role === 'user') history.push({ role: 'user', content: message.text });
    else {
      message.toolCalls.forEach((call) => called.add(call.callId));
      history.push(assistantOf(message));
    }
  }
  flush();
  return history;
}

function callsOf(content: readonly Anthropic.ContentBlock[], offered: readonly VerbName[]) {
  const calls: ToolCall[] = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    const verb = offered.find((name) => name === block.name);
    if (verb === undefined) throw new ToolOutsideToolsetError(block.name);
    calls.push({ callId: block.id, verb, input: block.input });
  }
  return calls;
}

function textOf(content: readonly Anthropic.ContentBlock[]): string | null {
  const parts = content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  return parts.length === 0 ? null : parts.join('\n');
}

function resultFrom(reply: Anthropic.Message, request: TurnRequest): TurnResult {
  const { input_tokens: inputTokens, output_tokens: outputTokens } = reply.usage;
  return {
    toolCalls: callsOf(reply.content, request.tools),
    text: textOf(reply.content),
    stopReason: stopReasons.get(reply.stop_reason ?? '') ?? 'refused',
    usage: {
      inputTokens,
      outputTokens,
      costMicros: costMicrosOf(reply.model, inputTokens, outputTokens),
      costBasis: 'metered',
    },
    resolvedProvider: PROVIDER,
    resolvedModel: reply.model,
  };
}

export function claudeMessagesTurn(config: EngineConfig): ModelEngine['turn'] {
  const client = clientOf(config);
  if (client === null) return () => notWiredCall('modelEngine', 'turn');
  return async (request) => {
    const pinned = request.pinnedProvider;
    if (pinned !== null && pinned !== PROVIDER) throw new ProviderMismatchError(pinned, PROVIDER);
    const messages = historyOf(request.messages);
    const tools = request.tools.map(toolSchema).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    const reply = await client.messages.create({
      model: request.model,
      system: request.instructions,
      max_tokens: MAX_TOKENS,
      tools,
      messages,
    });
    return resultFrom(reply, request);
  };
}
