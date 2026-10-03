import ts from 'typescript';

const hexColour = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const digitsOnly = /^#\d+$/;
const colourFunction = /\b(?:rgba?|hsla?|oklch)\(/;

const styleCarriers = [/\.(tsx|css|html)$/, /^packages\/ui\//, /^apps\/uw-app\/islands\//];

const literalKinds = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

export function carriesStyles(path: string): boolean {
  return styleCarriers.some((carrier) => carrier.test(path));
}

function literalTexts(path: string, text: string): string[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (literalKinds.has(node.kind)) found.push(node.getText(source));
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

export function hexColours(path: string, text: string): string[] {
  const texts = /\.tsx?$/.test(path) ? literalTexts(path, text) : [text];
  const styled = carriesStyles(path);
  return texts
    .flatMap((literal) => [...literal.matchAll(hexColour)].map((match) => match[0]))
    .filter((hex) => styled || !digitsOnly.test(hex));
}

export function hasColourLiteral(path: string, text: string): boolean {
  return hexColours(path, text).length > 0 || colourFunction.test(text);
}
