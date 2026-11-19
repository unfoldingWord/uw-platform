import { githubApps, manifestOf, ORG, REDIRECT_URL, type GitHubAppTarget } from './apps.ts';

function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formOf(target: GitHubAppTarget, state: string): string {
  const manifest = { ...manifestOf(target), redirect_url: REDIRECT_URL };
  const action = `https://github.com/organizations/${ORG}/settings/apps/new?state=${state}`;
  return [
    `<form method="post" action="${escaped(action)}">`,
    `<input type="hidden" name="manifest" value="${escaped(JSON.stringify(manifest))}">`,
    `<h2>${escaped(target.slug)}</h2>`,
    `<p>Used on: ${target.envs.join(' and ')}.</p>`,
    `<button type="submit">Register ${escaped(target.slug)}</button>`,
    '</form>',
  ].join('\n');
}

export function registerPage(state: string): string {
  const steps = [
    'Click a Register button. GitHub shows the App with its permissions; keep the name as given and confirm.',
    'On the new App, choose Install App and install it on unfoldingWord/uw-platform only.',
    'GitHub then lands on the uw-platform repository with ?code=… in the address bar. Send that whole address to the person setting the secrets, within the hour. The code works once.',
    'Repeat for each App.',
  ];
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Register GitHub Apps</title>',
    '<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}form{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}button{font:inherit;padding:.5rem 1rem}</style>',
    '</head><body>',
    '<h1>Register the uw-platform GitHub Apps</h1>',
    `<ol>${steps.map((step) => `<li>${escaped(step)}</li>`).join('')}</ol>`,
    ...githubApps.map((target) => formOf(target, state)),
    '</body></html>',
  ].join('\n');
}
