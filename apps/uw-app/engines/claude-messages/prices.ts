type TokenPrice = { readonly inputMicros: number; readonly outputMicros: number };

const prices: ReadonlyMap<string, TokenPrice> = new Map([
  ['claude-opus-4-1', { inputMicros: 15, outputMicros: 75 }],
  ['claude-sonnet-4-5', { inputMicros: 3, outputMicros: 15 }],
  ['claude-haiku-4-5', { inputMicros: 1, outputMicros: 5 }],
]);

function priceOf(model: string): TokenPrice | null {
  for (const [name, price] of prices) {
    if (model === name || model.startsWith(`${name}-`)) return price;
  }
  return null;
}

export function costMicrosOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = priceOf(model);
  if (price === null) return null;
  return inputTokens * price.inputMicros + outputTokens * price.outputMicros;
}
