import type { Rule } from 'eslint';

export const noCommentsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      comment:
        'Code carries no comments. Put the meaning in a name, a type, a test, or docs/ (AGENTS.md section 10).',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: 'comment' });
        }
      },
    };
  },
};

export const noCommentsPlugin = { rules: { 'no-comments': noCommentsRule } };
