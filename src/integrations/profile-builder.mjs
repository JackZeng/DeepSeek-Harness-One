export function buildRecommendedInstallPlan(extensions) {
  const sections = {
    required: [],
    recommended: [],
    optional: [],
  };
  for (const extension of extensions) {
    const commands = extension.install.kind === 'dsh-plugin'
      ? [`dsh plugin --profile ${extension.install.profile} add ${extension.install.source}`]
      : extension.install.commands ?? [];
    sections[extension.tier]?.push({ id: extension.id, name: extension.name, commands });
  }
  return sections;
}

export function formatInstallPlan(plan) {
  const lines = ['# DeepSeek Harness One integration plan', ''];
  for (const tier of ['required', 'recommended', 'optional']) {
    lines.push(`## ${tier[0].toUpperCase()}${tier.slice(1)}`, '');
    for (const extension of plan[tier] ?? []) {
      lines.push(`### ${extension.name}`, '');
      for (const command of extension.commands) lines.push('```sh', command, '```', '');
    }
  }
  return `${lines.join('\n')}\n`;
}
