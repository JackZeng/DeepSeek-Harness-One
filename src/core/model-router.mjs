import { clamp, normalizeWhitespace } from './utils.mjs';

const COMPLEX_TERMS = /\b(architecture|migration|security|distributed|concurrency|database|production|legal|financial|medical|架构|迁移|安全|并发|数据库|生产|法律|财务|医疗)\b/gi;
const SIMPLE_TERMS = /\b(rename|format|summarize|translate|copy|small|简单|改名|格式化|总结|翻译|复制)\b/gi;
const HIGH_IMPACT_TERMS = /\b(delete|remove|drop|production|credential|secret|publish|deploy|payment|rm\s+-rf|删除|清空|生产|凭据|密钥|发布|部署|支付)\b/gi;

export class ModelRouter {
  route({ goal, mode = 'auto', risk = { level: 'low' } }) {
    const text = normalizeWhitespace(goal);
    const complexityMatches = text.match(COMPLEX_TERMS)?.length ?? 0;
    const simpleMatches = text.match(SIMPLE_TERMS)?.length ?? 0;
    const highImpactMatches = text.match(HIGH_IMPACT_TERMS)?.length ?? 0;
    const lengthScore = clamp(Math.ceil(text.length / 220), 0, 4);
    const score = clamp(lengthScore + complexityMatches * 2 + highImpactMatches * 2 - simpleMatches, 0, 10);

    if (mode === 'fast') {
      return routeResult('fast', score, 'cheap', risk.level === 'high' ? 'strong' : 'cheap', 'strong');
    }
    if (mode === 'deep') {
      return routeResult('deep', score, 'strong', 'strong', 'strong');
    }

    const execution = score >= 7 || risk.level === 'high' ? 'strong' : 'cheap';
    return routeResult(
      'auto',
      score,
      'strong',
      execution,
      'strong',
      execution === 'strong'
        ? 'Complexity or risk warrants the strongest configured model throughout execution.'
        : 'A strong model plans and verifies while a lower-cost model handles routine execution.',
    );
  }
}

function routeResult(mode, score, planningTier, executionTier, reviewTier, reason) {
  return {
    mode,
    complexityScore: score,
    planning: { tier: planningTier },
    execution: { tier: executionTier },
    review: { tier: reviewTier },
    reason: reason ?? `${mode} mode selected by the user.`,
  };
}
