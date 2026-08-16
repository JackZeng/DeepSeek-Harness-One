import { createId, normalizeWhitespace } from './utils.mjs';

const CODING_TERMS = /\b(code|repo|repository|bug|feature|refactor|api|frontend|backend|test|deploy|build|项目|代码|仓库|修复|开发|接口|前端|后端|测试|部署)\b/i;
const RESEARCH_TERMS = /\b(research|investigate|compare|market|report|survey|分析|调研|比较|报告|研究|核实)\b/i;
const DESIGN_TERMS = /\b(design|prototype|ui|ux|slide|deck|image|visual|设计|原型|界面|演示|图片|视觉)\b/i;

export class Planner {
  createPlan({ goal, acceptanceCriteria = [] }) {
    const normalized = normalizeWhitespace(goal);
    let template = genericPlan();
    if (CODING_TERMS.test(normalized)) template = codingPlan();
    else if (RESEARCH_TERMS.test(normalized)) template = researchPlan();
    else if (DESIGN_TERMS.test(normalized)) template = designPlan();

    const phases = template.map((phase, index) => ({
      id: createId('phase'),
      index,
      title: phase.title,
      description: phase.description,
      status: 'pending',
      startedAt: null,
      completedAt: null,
    }));

    const criteria = acceptanceCriteria.length > 0
      ? acceptanceCriteria.map(normalizeCriterion).filter(Boolean)
      : defaultCriteria(template);

    return { phases, acceptanceCriteria: criteria };
  }
}

function codingPlan() {
  return [
    { title: 'Understand', description: 'Read the request, workspace rules and relevant context.' },
    { title: 'Inspect', description: 'Map the current implementation and identify the smallest coherent change.' },
    { title: 'Implement', description: 'Make the requested change while preserving project conventions.' },
    { title: 'Validate', description: 'Run the narrow checks first, then the project-level checks that matter.' },
    { title: 'Deliver', description: 'Summarize changes, evidence, risks and generated artifacts.' },
  ];
}

function researchPlan() {
  return [
    { title: 'Frame', description: 'Define the question, scope, assumptions and evidence standard.' },
    { title: 'Gather', description: 'Collect the highest-signal available sources and workspace material.' },
    { title: 'Evaluate', description: 'Reconcile conflicts, check freshness and separate facts from inference.' },
    { title: 'Synthesize', description: 'Build an answer-first narrative with implications and trade-offs.' },
    { title: 'Verify', description: 'Check claims, citations, completeness and delivery format.' },
  ];
}

function designPlan() {
  return [
    { title: 'Discover', description: 'Clarify audience, outcome, content and visual constraints.' },
    { title: 'Structure', description: 'Choose the information hierarchy and interaction model.' },
    { title: 'Create', description: 'Produce the first complete artifact rather than isolated fragments.' },
    { title: 'Critique', description: 'Review clarity, consistency, accessibility and visual polish.' },
    { title: 'Package', description: 'Export editable deliverables and document the design decisions.' },
  ];
}

function genericPlan() {
  return [
    { title: 'Understand', description: 'Clarify the goal, context and constraints from available evidence.' },
    { title: 'Plan', description: 'Break the work into a small set of observable outcomes.' },
    { title: 'Execute', description: 'Complete the work with bounded, reversible steps.' },
    { title: 'Check', description: 'Verify the result against the request and available evidence.' },
    { title: 'Deliver', description: 'Return the finished result, artifacts and concise follow-through.' },
  ];
}

function defaultCriteria(template) {
  return [
    'The final response directly answers the stated goal.',
    `All ${template.length} planned phases reach a terminal state.`,
    'The delivery includes concrete evidence or an artifact that can be inspected.',
    'No unresolved high-severity security finding remains.',
  ];
}

function normalizeCriterion(value) {
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (value && typeof value === 'object' && value.text) return normalizeWhitespace(value.text);
  return '';
}
