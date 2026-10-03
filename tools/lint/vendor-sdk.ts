export type VendorViolation = { path: string; line: number; text: string };

const vendorSdkImport =
  /(?:from|import|require\(|import\()\s*['"](?:@anthropic-ai\/|openai(?:\/|['"])|@openrouter\/|openrouter)/;

const scannedExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const engineDirectory =
  /^apps\/uw-app\/engines\/(?:claude-messages|openrouter-messages|claude-code-sandbox|codex-sandbox|claude-managed-agent|external)\//;
const scannedRoot = /^(?:apps|packages|sim|tests)\//;

export function isVendorScanned(path: string): boolean {
  return scannedRoot.test(path) && scannedExtension.test(path) && !engineDirectory.test(path);
}

export function findVendorViolations(path: string, source: string): VendorViolation[] {
  return source
    .split('\n')
    .flatMap((text, index) =>
      vendorSdkImport.test(text) ? [{ path, line: index + 1, text: text.trim() }] : [],
    );
}
