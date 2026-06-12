import { MockAiProvider } from '@echoloop/ai';
import { TRIAGE_EVAL_CASES, formatTriageEvalReport, runTriageEval } from '@echoloop/testing';
import { describe, expect, it } from 'vitest';

describe('synthetic triage evaluation set', () => {
  it('produces labeled counts, false positives/negatives, and uncertain cases', async () => {
    const ai = new MockAiProvider();
    for (const evalCase of TRIAGE_EVAL_CASES) {
      if (evalCase.mockOutput) ai.queueOutput('classification', evalCase.mockOutput);
    }

    const report = await runTriageEval(ai);
    expect(report.total).toBe(TRIAGE_EVAL_CASES.length);
    expect(report.labeledCounts.draft).toBeGreaterThan(0);
    expect(report.labeledCounts.skip).toBeGreaterThan(0);
    expect(report.labeledCounts.uncertain).toBeGreaterThan(0);
    // With scripted ideal outputs the eval is fully correct: no FP/FN.
    expect(report.falsePositives).toEqual([]);
    expect(report.falseNegatives).toEqual([]);
    expect(report.uncertain.length).toBe(1);
    expect(report.correct).toBe(report.total);

    const text = formatTriageEvalReport(report);
    expect(text).toContain('false positives: 0');
    expect(text).toContain('false negatives: 0');
  });

  it('counts misclassifications as false positives/negatives', async () => {
    const ai = new MockAiProvider();
    // Script the WRONG answers: FYI gets needsReply=true (FP), question gets needsReply=false (FN).
    for (const evalCase of TRIAGE_EVAL_CASES) {
      if (!evalCase.mockOutput) continue;
      const flipped = {
        ...evalCase.mockOutput,
        needsReply: !evalCase.mockOutput.needsReply,
        confidence: 0.95,
      };
      ai.queueOutput('classification', flipped);
    }
    const report = await runTriageEval(ai);
    expect(report.falsePositives.length).toBeGreaterThan(0);
    expect(report.falseNegatives.length).toBeGreaterThan(0);
  });

  it('model failures land in the failed bucket, never silently dropped', async () => {
    const ai = new MockAiProvider(); // nothing queued → provider error per model case
    const report = await runTriageEval(ai);
    const modelCases = TRIAGE_EVAL_CASES.filter(
      (c) =>
        !c.prefilter.isBulk &&
        !c.prefilter.isCalendar &&
        !/^no-?reply/i.test(c.prefilter.fromAddress ?? ''),
    );
    expect(report.failed.length).toBe(modelCases.length);
  });
});
