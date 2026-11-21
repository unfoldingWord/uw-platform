const ID = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';

export type Sample = { readonly name: string; readonly markdown: string };

export const roundTripSamples: readonly Sample[] = [
  {
    name: 'headings, emphasis and links',
    markdown: `## Rules\n\nUse **strong** passwords, *never* reuse them, and ~~write them down~~.\n\n### Links\n\nSee [the policy](https://example.org/policy) and [01.47 Security Guidelines](/pages/${ID}).`,
  },
  {
    name: 'lists, nested lists and numbered steps',
    markdown: '- one\n- two\n  - inner\n  - again\n- three\n\n1. First\n2. Second\n3. Third',
  },
  {
    name: 'a checklist',
    markdown: '- [x] Copy the program template\n- [ ] Enter the department number',
  },
  {
    name: 'a table with a line break in a cell',
    markdown:
      '| Item | Default | Exception |\n| --- | --- | --- |\n| Field program | Carry-on: yes<br>Checked: no | Carry-on: yes |\n| Charger | yes | no |',
  },
  {
    name: 'code, inline and fenced with a language',
    markdown:
      'Rows are summed with `=SUM(D3:D9)`.\n\n```javascript\n=sum(\n  indirect(A131 & "!D3")\n)\n```',
  },
  {
    name: 'a callout and a plain quote',
    markdown: '> [!WARNING]\n> Do not move any rows.\n\n> An ordinary quote.',
  },
  {
    name: 'a collapsible section with a list inside',
    markdown:
      '<details>\n<summary>Change log</summary>\n\n- 2025-07-01 three programs moved\n- 2025-08-01 one request\n\n</details>',
  },
  {
    name: 'a highlight, a picture and a rule',
    markdown:
      'Row 30 is ==always the income==.\n\n![The index](/api/files/3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11)\n\n---\n\nAfter the rule.',
  },
  {
    name: 'wiki links that are not resolved yet, and an embed',
    markdown: `Then read [[Travel Policy]] and [[01.47|the rules]].\n\n![Area Descriptions](/pages/${ID}#finance)`,
  },
];
