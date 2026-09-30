import type { Rule } from 'eslint';
import type { MemberExpression, Node } from 'estree';
import {
  bannedDateMethods,
  bannedIntlFormatters,
  dateFormatToken,
  isoStringCutters,
} from './date-patterns.ts';

const isOneOf = (words: readonly string[], name: string | undefined): name is string =>
  name !== undefined && words.includes(name);

function propertyName(node: MemberExpression): string | undefined {
  if (!node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return undefined;
}

function referencedName(node: Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name;
  }
  return node.type === 'MemberExpression' ? propertyName(node) : undefined;
}

function isIsoStringCall(node: Node): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    propertyName(node.callee) === 'toISOString'
  );
}

function checkMember(context: Rule.RuleContext, node: MemberExpression): void {
  const name = propertyName(node);
  if (isOneOf(bannedDateMethods, name)) {
    context.report({ node, messageId: 'localeMethod', data: { name } });
  } else if (isOneOf(bannedIntlFormatters, name) && referencedName(node.object) === 'Intl') {
    context.report({ node, messageId: 'intlFormatter', data: { name } });
  } else if (isOneOf(isoStringCutters, name) && isIsoStringCall(node.object)) {
    context.report({ node, messageId: 'isoStringCut' });
  }
}

function checkText(context: Rule.RuleContext, node: Node, text: string): void {
  if (dateFormatToken.test(text)) {
    context.report({ node, messageId: 'formatToken' });
  }
}

export const noAdHocDates: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Dates render and parse only through formatDate and parseDate in packages/core/dates.ts',
    },
    schema: [],
    messages: {
      localeMethod: '{{name}} is locale-dependent. Use formatDate from packages/core/dates.ts.',
      intlFormatter: 'Intl.{{name}} is locale-dependent. Use formatDate from packages/core/dates.ts.',
      isoStringCut: 'Cutting toISOString() is an ad-hoc date format. Use formatDate from packages/core/dates.ts.',
      formatToken: 'This is an ad-hoc date format string. Dates render only through packages/core/dates.ts.',
    },
  },
  create: (context) => ({
    MemberExpression: (node) => checkMember(context, node),
    Literal: (node) => {
      if (typeof node.value === 'string') {
        checkText(context, node, node.value);
      }
    },
    TemplateElement: (node) => checkText(context, node, node.value.raw),
  }),
};

export const datesPlugin = {
  meta: { name: 'uw-dates' },
  rules: { 'no-ad-hoc-dates': noAdHocDates },
};
