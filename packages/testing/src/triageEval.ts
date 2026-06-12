import type { AiProvider } from '@echoloop/ai';
import {
  deterministicExclusion,
  renderClassificationPrompt,
  TRIAGE_SYSTEM_PROMPT,
  type ClassificationInput,
  type PrefilterInput,
} from '@echoloop/correspondence';
import {
  TRIAGE_CONFIDENCE_THRESHOLD,
  type TriageResult,
  triageResultSchema,
} from '@echoloop/schemas';

/**
 * Synthetic labeled triage evaluation set (BUILD_BRIEF Phase 3 acceptance;
 * docs/EVALUATION.md). All content is synthetic — never real correspondence.
 * The report includes labeled counts, false positives, false negatives, and
 * uncertain cases per docs/EVALUATION.md's Phase 3 commitment.
 */

export type EvalLabel = 'draft' | 'skip' | 'uncertain';

export interface TriageEvalCase {
  name: string;
  expected: EvalLabel;
  prefilter: PrefilterInput;
  classification: ClassificationInput;
  /** Output the mock provider should return when this case reaches the model. */
  mockOutput?: TriageResult;
}

const baseInput = (over: Partial<ClassificationInput>): ClassificationInput => ({
  subject: 'Subject',
  bodyText: 'Body',
  fromAddress: 'sender@client.test',
  toAddresses: ['pilot@example.test'],
  ccAddresses: [],
  accountEmail: 'pilot@example.test',
  ...over,
});

const eligible = (fromAddress = 'sender@client.test'): PrefilterInput => ({
  labels: ['INBOX'],
  direction: 'inbound',
  fromAddress,
  isBulk: false,
  isCalendar: false,
});

const triage = (over: Partial<TriageResult>): TriageResult =>
  triageResultSchema.parse({
    needsReply: true,
    messageTypes: ['information_request'],
    relationship: { value: 'client', source: 'inferred' },
    isGroupThread: false,
    isInternal: false,
    confidence: 0.9,
    ...over,
  });

export const TRIAGE_EVAL_CASES: TriageEvalCase[] = [
  {
    name: 'newsletter (bulk headers) is skipped deterministically',
    expected: 'skip',
    prefilter: { ...eligible('news@updates.test'), isBulk: true },
    classification: baseInput({ subject: 'Weekly digest' }),
  },
  {
    name: 'no-reply notification is skipped deterministically',
    expected: 'skip',
    prefilter: eligible('no-reply@service.test'),
    classification: baseInput({ fromAddress: 'no-reply@service.test' }),
  },
  {
    name: 'calendar invite is skipped deterministically',
    expected: 'skip',
    prefilter: { ...eligible(), isCalendar: true },
    classification: baseInput({ subject: 'Invitation: Sync' }),
  },
  {
    name: 'client asks a clear question → draft',
    expected: 'draft',
    prefilter: eligible(),
    classification: baseInput({
      subject: 'Timeline question',
      bodyText: 'When can we expect the deliverable?',
    }),
    mockOutput: triage({ questionsAsked: ['When can we expect the deliverable?'] }),
  },
  {
    name: 'client requests action with a date → draft, mixed types represented',
    expected: 'draft',
    prefilter: eligible(),
    classification: baseInput({
      subject: 'Action needed',
      bodyText: 'Please send the contract by Friday, and what is the price?',
    }),
    mockOutput: triage({
      messageTypes: ['mixed_information_action'],
      requestedActions: ['Send the contract'],
      questionsAsked: ['What is the price?'],
      deadlines: ['Friday'],
    }),
  },
  {
    name: 'pure FYI needs no reply → skip',
    expected: 'skip',
    prefilter: eligible(),
    classification: baseInput({ subject: 'FYI', bodyText: 'Just so you know, shipping went out.' }),
    mockOutput: triage({
      needsReply: false,
      messageTypes: ['no_response_required'],
      confidence: 0.85,
    }),
  },
  {
    name: 'ambiguous message routes to manual review',
    expected: 'uncertain',
    prefilter: eligible('mystery@unknown.test'),
    classification: baseInput({
      fromAddress: 'mystery@unknown.test',
      subject: 'hm',
      bodyText: 'thoughts?',
    }),
    mockOutput: triage({
      relationship: { value: 'unknown', source: 'inferred' },
      confidence: 0.4,
      uncertainties: ['Sender and intent unclear'],
    }),
  },
];

export interface TriageEvalReport {
  total: number;
  labeledCounts: Record<EvalLabel, number>;
  correct: number;
  falsePositives: { name: string }[];
  falseNegatives: { name: string }[];
  uncertain: { name: string }[];
  failed: { name: string; error: string }[];
}

export async function runTriageEval(
  ai: AiProvider,
  cases: TriageEvalCase[] = TRIAGE_EVAL_CASES,
): Promise<TriageEvalReport> {
  const report: TriageEvalReport = {
    total: cases.length,
    labeledCounts: { draft: 0, skip: 0, uncertain: 0 },
    correct: 0,
    falsePositives: [],
    falseNegatives: [],
    uncertain: [],
    failed: [],
  };

  for (const evalCase of cases) {
    report.labeledCounts[evalCase.expected] += 1;

    let predicted: EvalLabel;
    if (deterministicExclusion(evalCase.prefilter)) {
      predicted = 'skip';
    } else {
      try {
        const result = await ai.complete({
          role: 'classification',
          system: TRIAGE_SYSTEM_PROMPT,
          user: renderClassificationPrompt(evalCase.classification),
          schema: triageResultSchema,
          maxTokens: 2048,
        });
        if (result.output.confidence < TRIAGE_CONFIDENCE_THRESHOLD) {
          predicted = 'uncertain';
        } else {
          predicted = result.output.needsReply ? 'draft' : 'skip';
        }
      } catch (err) {
        report.failed.push({
          name: evalCase.name,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    if (predicted === 'uncertain') report.uncertain.push({ name: evalCase.name });
    if (predicted === evalCase.expected) {
      report.correct += 1;
    } else if (predicted === 'draft' && evalCase.expected === 'skip') {
      report.falsePositives.push({ name: evalCase.name });
    } else if (predicted === 'skip' && evalCase.expected === 'draft') {
      report.falseNegatives.push({ name: evalCase.name });
    }
  }

  return report;
}

export function formatTriageEvalReport(report: TriageEvalReport): string {
  return [
    `Triage evaluation — ${report.total} labeled cases`,
    `  labeled: draft=${report.labeledCounts.draft} skip=${report.labeledCounts.skip} uncertain=${report.labeledCounts.uncertain}`,
    `  correct: ${report.correct}/${report.total}`,
    `  false positives: ${report.falsePositives.length} ${report.falsePositives.map((c) => c.name).join('; ')}`,
    `  false negatives: ${report.falseNegatives.length} ${report.falseNegatives.map((c) => c.name).join('; ')}`,
    `  uncertain: ${report.uncertain.length} ${report.uncertain.map((c) => c.name).join('; ')}`,
    `  failed: ${report.failed.length} ${report.failed.map((c) => `${c.name} (${c.error})`).join('; ')}`,
  ].join('\n');
}
