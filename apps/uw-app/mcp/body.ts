import { boundedText, MAX_BODY_BYTES } from '../http/body.ts';

type BodyRefusal = { readonly status: 400 | 413; readonly code: number; readonly message: string };
type Body =
  { readonly ok: true; readonly message: unknown } | ({ readonly ok: false } & BodyRefusal);

const tooLarge: BodyRefusal = {
  status: 413,
  code: -32000,
  message: `Payload Too Large: Request body must not exceed ${MAX_BODY_BYTES} bytes`,
};
const notJson: BodyRefusal = { status: 400, code: -32700, message: 'Parse error: Invalid JSON' };
const batch: BodyRefusal = {
  status: 400,
  code: -32600,
  message: 'Invalid Request: batch requests are not accepted',
};

function parsedJson(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

export async function singleMessage(request: Request): Promise<Body> {
  const text = await boundedText(request);
  if (text === null) return { ok: false, ...tooLarge };
  const parsed = parsedJson(text);
  if (parsed === null) return { ok: false, ...notJson };
  if (Array.isArray(parsed.value)) return { ok: false, ...batch };
  return { ok: true, message: parsed.value };
}

export function jsonRpcError(refusal: BodyRefusal): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: refusal.code, message: refusal.message }, id: null },
    { status: refusal.status },
  );
}
