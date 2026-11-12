import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  RaphaelEngine,
  LinUCBNudgeBandit,
  MusicFlowBandit,
  CurriculumCoach,
  WorkGraphEngine,
  buildContextVector16,
  computeLocalEmbedding512,
  cosineSimilarity512
} from '../src/understanding/raphael-ml.mjs';
import { Workspace } from '../src/workspace.mjs';
import { createAppleRuntime } from '../src/apple/runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('Raphael ML: 512-dim embeddings, FSRS-4.5 forgetting curve, LinUCB Sherman-Morrison, and Thompson Sampling Music DJ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kst-raphael-'));
  try {
    const db = new DatabaseSync(join(dir, 'raphael.sqlite'));
    db.exec(readFileSync(join(root, 'migrations', '001_foundation.sql'), 'utf8'));
    db.exec(readFileSync(join(root, 'migrations', '002_raphael_graph.sql'), 'utf8'));

    const fixedNow = Date.parse('2026-04-20T14:30:00.000Z');
    const raphael = new RaphaelEngine(db, { now: () => fixedNow });

    // 1. 512-dim embedding & cosine similarity
    const vSwift = computeLocalEmbedding512('Swift concurrency actor isolation Sendable data race');
    const vSwift2 = computeLocalEmbedding512('Swift actor Sendable concurrency task group');
    const vMusic = computeLocalEmbedding512('Baroque chamber cello sonata playlist');
    assert.equal(vSwift.length, 512);
    assert.ok(cosineSimilarity512(vSwift, vSwift2) > 0.45);
    assert.ok(cosineSimilarity512(vSwift, vSwift2) > cosineSimilarity512(vSwift, vMusic));

    // 2. FSRS-4.5 Retrievability & Skill Coach
    const rDecay = raphael.curriculum.computeRetrievability(2.0, fixedNow - 4 * 86_400_000, fixedNow);
    // R = (1 + 19/81 * (4 / 2))^(-0.5) = (1 + 38/81)^(-0.5) = (119/81)^(-0.5) ≈ 0.8250
    assert.ok(Math.abs(rDecay - 0.825) < 0.005);

    const initialRec = raphael.curriculum.recommend({ limit: 4 });
    assert.ok(initialRec.topRecommendation);
    const practiced = raphael.curriculum.recordPractice({
      topicOrId: initialRec.topRecommendation.topicName,
      grade: 4
    });
    assert.ok(practiced.newStabilityDays > practiced.previousStabilityDays);
    assert.equal(practiced.retrievability, 1.0);

    // 3. Disjoint LinUCB Nudge Bandit (d=16)
    const deepCtx = raphael.nudgeBandit.decide({
      frontmostApp: 'Xcode',
      windowTitle: 'RAPHAEL_SYSTEM_DESIGN_AND_LLD.md',
      activeMinutes: 35,
      appSwitchesLast5m: 1,
      secondsSinceAppSwitch: 180
    });
    assert.equal(deepCtx.workMode, 'DEEP_ARCHITECTURE');
    assert.equal(deepCtx.contextVector.length, 16);

    const upd = raphael.nudgeBandit.update('WAIT_FOR_APP_SWITCH', deepCtx.contextVector, 1.0);
    assert.equal(upd.pulls, 1);
    assert.equal(upd.cumulativeReward, 1.0);

    // 4. Contextual Thompson Sampling Music DJ Bandit
    const musicRec = raphael.musicBandit.recommend({ mode: 'FAST_EXECUTION', deterministic: true });
    assert.equal(musicRec.mode, 'FAST_EXECUTION');
    assert.ok(musicRec.recommendedPlaylist.length > 0);
    const fb = raphael.musicBandit.recordFeedback({
      mode: 'FAST_EXECUTION',
      playlist: musicRec.recommendedPlaylist,
      reward: 1.0
    });
    assert.equal(fb.pulls, 1);

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Raphael Runtime E2E: Co-Pilot Sidecar Bridge, Terminal Sentinel, Skill Coach, and Music DJ voice commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kst-raphael-rt-'));
  try {
    const fixedNow = Date.parse('2026-04-20T15:00:00.000Z');
    const workspace = new Workspace({ dataDir: join(dir, 'ws'), now: () => fixedNow });
    const mockBroker = {
      available: true,
      calls: [],
      async call(method, params) {
        this.calls.push({ method, params });
        if (params?.domain === 'sidecar' && params?.action === 'readTerminalFailure') {
          return {
            status: 'ok',
            sessionName: 'iTerm2',
            gitBranch: 'feat/raphael-v0.8',
            gitStatus: 'M apps/macos/Sources/KstApp/AppleEcosystemBroker.swift',
            tailText: 'error: actor-isolated property cannot be referenced from a Sendable closure',
            errorSnippet: 'error: actor-isolated property cannot be referenced from a Sendable closure'
          };
        }
        if (params?.domain === 'sidecar' && params?.action === 'injectPromptContext') {
          return {
            status: 'injected',
            targetApp: params.payload.targetApp,
            clipboardStaged: true,
            charactersStaged: params.payload.promptText.length
          };
        }
        if (params?.domain === 'sidecar' && params?.action === 'readCompanionContext') {
          return {
            status: 'ok',
            companionApp: 'Gemini',
            sourceDomain: 'gemini_web',
            url: 'https://gemini.google.com/app/123',
            transcript: '- Add Sendable conformance to AppleEcosystemBroker\n- Verify SQLite WAL busy_timeout in workspace.mjs'
          };
        }
        if (params?.domain === 'music' && params?.action === 'playbackControl') {
          return { status: 'ok', command: params.payload.command };
        }
        return { status: 'ok' };
      }
    };

    const runtime = createAppleRuntime({
      dataDir: join(dir, 'apple'),
      workspace,
      broker: mockBroker,
      now: () => fixedNow
    });

    // 1. What should I learn?
    const learnRes = await runtime.converse({ requestId: 'req-learn-1', text: 'what should I learn next' });
    assert.ok(learnRes.reply.includes('Recommended next skill'));
    assert.ok(learnRes.apple.topRecommendation.topicName.length > 0);

    // 2. Play music for deep work
    const musicRes = await runtime.converse({ requestId: 'req-music-1', text: 'play music for deep work' });
    assert.ok(musicRes.reply.includes('Contextual Thompson Sampling'));
    assert.equal(musicRes.apple.mode, 'DEEP_ARCHITECTURE');

    // 3. Explain my last terminal error
    const termRes = await runtime.converse({ requestId: 'req-term-1', text: 'explain my last terminal error' });
    assert.ok(termRes.reply.includes('Terminal Sentinel'));
    assert.ok(termRes.reply.includes('Sendable'));

    // 4. Brief Gemini on my current bug
    const briefRes = await runtime.converse({ requestId: 'req-brief-1', text: 'brief Gemini on my current bug' });
    assert.ok(briefRes.reply.includes('Briefed Gemini'));
    assert.ok(briefRes.apple.packet.promptText.includes('<kst_work_context'));
    assert.ok(briefRes.apple.packet.promptText.includes('feat/raphael-v0.8'));

    // 5. Capture tasks from Gemini
    const capRes = await runtime.converse({ requestId: 'req-cap-1', text: 'capture tasks from Gemini' });
    assert.equal(capRes.apple.capturedCount, 2);
    assert.ok(capRes.reply.includes('Add Sendable conformance'));

    // 6. Raphael Status Briefing
    const statusRes = await runtime.converse({ requestId: 'req-stat-1', text: 'raphael status report' });
    assert.ok(statusRes.reply.includes('Raphael Status'));

    runtime.close();
    workspace.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
