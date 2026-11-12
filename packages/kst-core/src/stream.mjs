import { randomUUID } from 'node:crypto';
import { Fault } from './engine.mjs';

/**
 * ClauseStreamAssembler splits streaming LLM token deltas into natural prosody clauses
 * with exact `[charStart, charEnd)` character offsets so the native macOS app can:
 * 1. Start speaking Clause 0 within ~250ms while subsequent clauses generate.
 * 2. Compute sample-accurate `spokenCharIndex` when the user barges in mid-utterance.
 */
export class ClauseStreamAssembler {
  constructor({ turnId, onClause } = {}) {
    this.turnId = turnId;
    this.onClause = onClause;
    this.fullText = '';
    this.emittedOffset = 0;
    this.clauseIndex = 0;
  }

  push(delta) {
    if (typeof delta !== 'string' || !delta.length) return [];
    this.fullText += delta;
    const emitted = [];
    while (true) {
      const pending = this.fullText.slice(this.emittedOffset);
      if (!pending.length) break;
      const boundaryIndex = ClauseStreamAssembler.findBoundary(pending);
      if (boundaryIndex === -1) break;
      const clauseText = pending.slice(0, boundaryIndex);
      const charStart = this.emittedOffset;
      const charEnd = charStart + clauseText.length;
      const clause = {
        turnId: this.turnId,
        clauseIndex: this.clauseIndex++,
        charStart,
        charEnd,
        text: clauseText
      };
      this.emittedOffset = charEnd;
      emitted.push(clause);
      this.onClause?.(clause);
    }
    return emitted;
  }

  flush() {
    const pending = this.fullText.slice(this.emittedOffset);
    if (!pending.trim().length) {
      this.emittedOffset = this.fullText.length;
      return null;
    }
    const charStart = this.emittedOffset;
    const charEnd = this.fullText.length;
    const clause = {
      turnId: this.turnId,
      clauseIndex: this.clauseIndex++,
      charStart,
      charEnd,
      text: pending
    };
    this.emittedOffset = charEnd;
    this.onClause?.(clause);
    return clause;
  }

  static findBoundary(text) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '\n' && i >= 8) return i + 1;
      if ((ch === '.' || ch === '?' || ch === '!' || ch === ':' || ch === ';') && (next === ' ' || next === '\n')) {
        if (i >= 12) return i + 2;
      }
      if (ch === ',' && next === ' ' && i >= 36) {
        return i + 2;
      }
    }
    return -1;
  }
}

/**
 * Manages the 6-turn (12-message) ephemeral rolling dialogue buffer, `<active_context>`
 * builder (capped <= 300 tokens for the 4,096-token Apple Foundation Models window),
 * in-flight streaming turn controllers, and barge-in interruption truncation.
 */
export function createConversationStreamCoordinator({ engine, workspace, apple, broker, external, now = Date.now } = {}) {
  const MAX_HISTORY_MESSAGES = 12;
  const HISTORY_TTL_MS = 15 * 60 * 1000;
  const activeTurns = new Map();
  let history = [];
  let lastActivityTs = 0;
  let lastMutatedEntity = null;
  let stitchedPrefix = '';
  let intelligenceSettings = {
    activeTier1Provider: 'foundationModels',
    mlxOptionalEnabled: false,
    preCommitHoldMs: 0
  };

  function pruneExpiredHistory() {
    const current = now();
    if (lastActivityTs > 0 && current - lastActivityTs > HISTORY_TTL_MS) {
      history = [];
      lastMutatedEntity = null;
      stitchedPrefix = '';
    }
  }

  function clearContext() {
    history = [];
    lastMutatedEntity = null;
    stitchedPrefix = '';
    for (const [, entry] of activeTurns) {
      entry.controller.abort();
    }
    activeTurns.clear();
  }

  function buildActiveContext() {
    pruneExpiredHistory();
    const snap = workspace?.snapshot?.() ?? { tasks: [], reminders: [], calendar: [] };
    const recentEntities = [
      ...(snap.calendar ?? []).slice(0, 3).map((e) => ({ id: e.id, kind: 'meeting', title: e.title, scheduledAt: e.startAt, revision: e.updated_at })),
      ...(snap.reminders ?? []).slice(0, 3).map((r) => ({ id: r.id, kind: 'reminder', title: r.title, scheduledAt: r.fireAt, revision: r.updated_at })),
      ...(snap.tasks ?? []).slice(0, 3).map((t) => ({ id: t.id, kind: 'task', title: t.title, dueAt: t.dueAt, revision: t.updated_at }))
    ].slice(0, 8);

    const pendingConfirmations = [
      ...(apple?.pendingConfirmations?.() ?? []).slice(0, 2),
      ...(engine?.status?.().approvals ?? []).filter((a) => a.status === 'pending').slice(0, 2).map((a) => ({
        confirmationId: a.id,
        kind: `external.${a.service}`,
        preview: a.prompt,
        expiresAt: a.expiresAt
      }))
    ].slice(0, 2);

    const nowMs = now();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(nowMs));
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(nowMs));
    const tzParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short'
    }).formatToParts(new Date(nowMs));
    const tzShort = tzParts.find((p) => p.type === 'timeZoneName')?.value || tz;

    return {
      nowIso: new Date(nowMs).toISOString(),
      currentLocalTime: `${timeStr} (${tzShort})`,
      currentLocalDate: dateStr,
      timezone: tz,
      lastMutatedEntity,
      recentEntities,
      pendingConfirmations
    };
  }

  function recordTurnPair(turnId, userText, assistantText, receiptSummary = null) {
    pruneExpiredHistory();
    lastActivityTs = now();
    history.push({ turnId, role: 'user', text: String(userText).slice(0, 600) });
    const summaryPrefix = receiptSummary ? `[${receiptSummary}] ` : '';
    history.push({ turnId, role: 'assistant', text: `${summaryPrefix}${String(assistantText).slice(0, 600)}` });
    if (history.length > MAX_HISTORY_MESSAGES) {
      history = history.slice(history.length - MAX_HISTORY_MESSAGES);
    }
  }

  function interruptTurn({ requestId, turnId, spokenCharIndex = 0, reason = 'user_barge_in' }) {
    if (!Number.isSafeInteger(spokenCharIndex) || spokenCharIndex < 0) {
      throw new Fault('INVALID_OFFSET', 'spokenCharIndex must be a non-negative integer.');
    }
    const active = activeTurns.get(turnId);
    if (active) {
      active.interrupted = true;
      active.spokenCharIndex = spokenCharIndex;
      active.interruptReason = reason;
      active.controller.abort();
      activeTurns.delete(turnId);
      if (reason === 'user_continuation' && spokenCharIndex === 0 && active.committedReceipts.length === 0) {
        stitchedPrefix = `${active.userText.trim()} `;
      }
    }

    let truncatedText = '';
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].turnId === turnId && history[i].role === 'assistant') {
        const raw = history[i].text;
        const cut = raw.slice(0, Math.min(raw.length, spokenCharIndex));
        truncatedText = spokenCharIndex === 0 ? '[interrupted before speech]' : `${cut}[interrupted by user]`;
        history[i].text = truncatedText;
        break;
      }
    }
    if (!truncatedText && active) {
      const cut = (active.fullText || '').slice(0, spokenCharIndex);
      truncatedText = spokenCharIndex === 0 ? '[interrupted before speech]' : `${cut}[interrupted by user]`;
      if (spokenCharIndex > 0 || active.committedReceipts.length > 0) {
        recordTurnPair(turnId, active.userText, truncatedText);
      }
    }

    const committedReceipts = active?.committedReceipts ?? [];
    const status = reason === 'user_continuation' && spokenCharIndex === 0 && committedReceipts.length === 0
      ? 'STITCHED_CONTINUATION'
      : committedReceipts.length > 0
      ? 'COMMITTED_INTERJECTED'
      : 'INTERRUPTED';

    return {
      turnId,
      requestId,
      status,
      reason,
      spokenCharIndex,
      truncatedText,
      committedReceipts,
      lastMutatedEntity
    };
  }

  /**
   * Executes a streaming conversation turn (`POST /api/conversation/stream`).
   * Priority 1: Direct Apple-Native Suite execution (`apple.converse`) so Calendar, Reminders,
   * Notes, Mail, Messages, Safari, Spotlight, Music, and Schedule Plan actions execute in <50ms.
   * Priority 1B: Deterministic Workspace skills (`workspace.converse`) for tasks, notes, reminders,
   * and day scheduling before invoking the 3B model.
   * Priority 2: Tier 1A LocalIntelligenceBroker (`FoundationModels` 3B) for open-ended reasoning.
   */
  async function streamTurn(body, sendEvent, fallbackHandler) {
    const turnId = body.turnId ?? `trn_${randomUUID()}`;
    const requestId = body.requestId;
    const source = body.source ?? 'voice';

    if (body.interruptedTurn && typeof body.interruptedTurn.turnId === 'string') {
      interruptTurn({
        requestId: `${requestId}-int`,
        turnId: body.interruptedTurn.turnId,
        spokenCharIndex: Number(body.interruptedTurn.spokenCharIndex ?? 0),
        reason: body.interruptedTurn.reason ?? 'user_barge_in'
      });
    }

    let effectiveText = String(body.text ?? '').trim();
    if (stitchedPrefix) {
      effectiveText = `${stitchedPrefix}${effectiveText}`.trim();
      stitchedPrefix = '';
    }

    const controller = new AbortController();
    const turnEntry = {
      requestId,
      turnId,
      userText: effectiveText,
      fullText: '',
      committedReceipts: [],
      startedAt: now(),
      controller,
      interrupted: false
    };
    activeTurns.set(turnId, turnEntry);

    const assembler = new ClauseStreamAssembler({
      turnId,
      onClause: (clause) => {
        if (!turnEntry.interrupted) {
          sendEvent('clause', clause);
        }
      }
    });

    try {
      // 1. Direct Apple-Native Executive Suite match (guarantees Calendar, Reminders, Notes, Mail, iMessage, Schedule Plan execution in <50ms!)
      if (apple?.converse) {
        const directApple = await apple.converse({ ...body, text: effectiveText });
        if (directApple !== null) {
          const replyText = String(directApple.reply ?? 'Done.');
          turnEntry.fullText = replyText;
          if (directApple.apple?.status === 'NEEDS_CONFIRMATION' && directApple.apple?.confirmationId) {
            sendEvent('confirmation_staged', {
              turnId,
              confirmationId: directApple.apple.confirmationId,
              kind: directApple.apple.kind,
              preview: directApple.apple.preview
            });
          } else if (directApple.apple?.id) {
            const receiptId = `rcp_${requestId}`;
            turnEntry.committedReceipts.push(receiptId);
            lastMutatedEntity = {
              id: directApple.apple.id,
              nativeId: directApple.apple.nativeId ?? directApple.apple.id,
              kind: 'apple.action',
              title: directApple.apple.title ?? '',
              revision: Date.now(),
              receiptId
            };
            sendEvent('receipt', {
              turnId,
              receiptId,
              kind: 'apple.action',
              status: 'COMMITTED',
              entityId: directApple.apple.id,
              nativeId: directApple.apple.nativeId ?? directApple.apple.id
            });
          }
          assembler.push(replyText);
          assembler.flush();
          recordTurnPair(turnId, effectiveText, replyText, turnEntry.committedReceipts[0] ?? null);
          const donePayload = {
            turnId,
            requestId,
            conversationId: directApple.conversationId ?? body.conversationId ?? `conversation-${requestId}`,
            fullText: replyText,
            tierUsed: 'tier1_apple_native_direct',
            latencyMs: Math.max(1, now() - turnEntry.startedAt)
          };
          sendEvent('done', donePayload);
          return donePayload;
        }
      }

      // 1B. Direct Workspace Executive Skills match (fast <10ms execution for tasks, day plan, notes, reminders)
      const directWorkspace = workspace?.converse?.(requestId, effectiveText, body.conversationId);
      if (directWorkspace) {
        const replyText = String(directWorkspace.reply ?? 'Done.');
        turnEntry.fullText = replyText;
        assembler.push(replyText);
        assembler.flush();
        if (directWorkspace.result?.id) {
          const receiptId = `rcp_${requestId}`;
          turnEntry.committedReceipts.push(receiptId);
          lastMutatedEntity = {
            id: directWorkspace.result.id,
            nativeId: directWorkspace.result.nativeId ?? directWorkspace.result.id,
            kind: directWorkspace.result.kind ?? 'workspace.action',
            revision: Date.now(),
            receiptId
          };
          sendEvent('receipt', {
            turnId,
            receiptId,
            kind: directWorkspace.result.kind ?? 'workspace.action',
            status: 'COMMITTED',
            entityId: directWorkspace.result.id
          });
        }
        recordTurnPair(turnId, effectiveText, replyText, turnEntry.committedReceipts[0] ?? null);
        const donePayload = {
          turnId,
          requestId,
          conversationId: directWorkspace.conversationId ?? body.conversationId ?? `conversation-${requestId}`,
          fullText: replyText,
          tierUsed: 'tier0_workspace_skill_fast',
          latencyMs: Math.max(1, now() - turnEntry.startedAt)
        };
        sendEvent('done', donePayload);
        return donePayload;
      }

      // 2. Tier 1 Local Intelligence Broker path (Apple Foundation Models 3B)
      if (broker?.available) {
        const activeContext = buildActiveContext();
        let toolCallCount = 0;
        const inferResult = await broker.inferStream({
          turnId,
          text: effectiveText,
          activeContext,
          history: history.slice(-12),
          signal: controller.signal,
          onDelta: (delta) => {
            turnEntry.fullText += delta;
            assembler.push(delta);
          },
          onToolCall: async ({ toolCallId, kind, args }) => {
            toolCallCount++;
            if (toolCallCount > 4) {
              return { status: 'capped', message: 'Maximum of 4 tool calls per turn reached. Summarize progress to the user.' };
            }
            sendEvent('tool_preview', { turnId, toolCallId, kind });

            const isMutating = !/(?:List|Availability|Search|Read|Context|Resolve)$/i.test(kind);
            if (source === 'voice' && isMutating && intelligenceSettings.preCommitHoldMs > 0) {
              await new Promise((r) => setTimeout(r, intelligenceSettings.preCommitHoldMs));
              if (controller.signal.aborted || turnEntry.interrupted) {
                throw new Fault('TURN_INTERRUPTED', 'Aborted before mutation commit.', 499);
              }
            }

            if (kind === 'external.stageApproval') {
              const service = String(args.service ?? 'claude').toLowerCase();
              const prompt = String(args.prompt ?? effectiveText).trim();
              const staged = engine.proposeExternal(`${requestId}-${toolCallId}`, {
                service,
                prompt,
                conversationId: body.conversationId ?? `conversation-${requestId}`
              }, external?.describe?.(service));
              sendEvent('approval_staged', {
                turnId,
                approvalId: staged.approval.id,
                service,
                prompt
              });
              return { status: 'approval_staged', approvalId: staged.approval.id, message: staged.reply };
            }

            const result = await apple.executeToolAction({
              requestId: `${requestId}-${toolCallId}`,
              kind,
              args
            });

            if (result?.status === 'NEEDS_CONFIRMATION' && result?.confirmationId) {
              sendEvent('confirmation_staged', {
                turnId,
                confirmationId: result.confirmationId,
                kind: result.kind,
                preview: result.preview
              });
            } else if (isMutating && result?.id) {
              const receiptId = `rcp_${toolCallId}`;
              turnEntry.committedReceipts.push(receiptId);
              lastMutatedEntity = {
                id: result.id,
                nativeId: result.nativeId ?? result.id,
                kind,
                title: args.title ?? args.target ?? '',
                revision: Date.now(),
                receiptId
              };
              sendEvent('receipt', {
                turnId,
                receiptId,
                kind,
                status: 'COMMITTED',
                entityId: result.id,
                nativeId: result.nativeId ?? result.id
              });
            }
            return result;
          }
        });

        assembler.flush();
        const finalReply = assembler.fullText.trim() || inferResult?.reply || 'Done.';
        if (!assembler.fullText.trim() && finalReply) {
          assembler.push(finalReply);
          assembler.flush();
        }
        recordTurnPair(turnId, effectiveText, finalReply, turnEntry.committedReceipts[0] ?? null);
        const donePayload = {
          turnId,
          requestId,
          conversationId: body.conversationId ?? `conversation-${requestId}`,
          fullText: finalReply,
          tierUsed: inferResult?.tierUsed ?? 'tier1a_foundation_models',
          latencyMs: Math.max(1, now() - turnEntry.startedAt)
        };
        sendEvent('done', donePayload);
        return donePayload;
      }

      // 3. Deterministic Fallback Path
      const fallbackResult = await fallbackHandler({ ...body, text: effectiveText });
      const replyText = String(fallbackResult?.reply ?? 'Done.');
      turnEntry.fullText = replyText;
      assembler.push(replyText);
      assembler.flush();
      if (fallbackResult?.result?.id) {
        const receiptId = `rcp_${requestId}`;
        turnEntry.committedReceipts.push(receiptId);
        lastMutatedEntity = {
          id: fallbackResult.result.id,
          nativeId: fallbackResult.result.nativeId ?? fallbackResult.result.id,
          kind: fallbackResult.result.kind ?? 'workspace.action',
          revision: Date.now(),
          receiptId
        };
        sendEvent('receipt', {
          turnId,
          receiptId,
          kind: fallbackResult.result.kind ?? 'workspace.action',
          status: 'COMMITTED',
          entityId: fallbackResult.result.id
        });
      }
      recordTurnPair(turnId, effectiveText, replyText, turnEntry.committedReceipts[0] ?? null);
      const donePayload = {
        turnId,
        requestId,
        conversationId: fallbackResult?.conversationId ?? body.conversationId ?? `conversation-${requestId}`,
        fullText: replyText,
        tierUsed: 'tier0_deterministic',
        latencyMs: Math.max(1, now() - turnEntry.startedAt)
      };
      sendEvent('done', donePayload);
      return donePayload;
    } finally {
      activeTurns.delete(turnId);
    }
  }

  function status() {
    pruneExpiredHistory();
    return {
      localReasoning: true,
      tier1A: {
        provider: 'foundationModels',
        available: Boolean(broker?.available),
        model: 'Apple-OnDevice-3B'
      },
      tier1B: {
        provider: 'mlxSwift',
        compiled: Boolean(process.env.KST_ENABLE_MLX === '1'),
        enabled: intelligenceSettings.mlxOptionalEnabled,
        loadedModelId: null,
        wiredBytes: 0
      },
      tier2Providers: {
        claude: process.env.KST_ANTHROPIC_API_KEY ? 'configured' : 'setup-required',
        gemini: process.env.KST_GEMINI_API_KEY ? 'configured' : 'setup-required',
        chatgpt: process.env.KST_OPENAI_API_KEY ? 'configured' : 'setup-required',
        codex: process.env.KST_CODEX_ENABLED === '1' ? 'configured' : 'setup-required'
      },
      activeConversationTurns: Math.floor(history.length / 2),
      lastMutatedEntity,
      settings: intelligenceSettings
    };
  }

  function updateIntelligenceSettings(patch = {}) {
    if (patch.activeTier1Provider && ['foundationModels', 'mlxSwift'].includes(patch.activeTier1Provider)) {
      intelligenceSettings.activeTier1Provider = patch.activeTier1Provider;
    }
    if (typeof patch.mlxOptionalEnabled === 'boolean') {
      intelligenceSettings.mlxOptionalEnabled = patch.mlxOptionalEnabled;
    }
    if (Number.isInteger(patch.preCommitHoldMs) && patch.preCommitHoldMs >= 0 && patch.preCommitHoldMs <= 500) {
      intelligenceSettings.preCommitHoldMs = patch.preCommitHoldMs;
    }
    return status();
  }

  return {
    streamTurn,
    interruptTurn,
    buildActiveContext,
    clearContext,
    status,
    updateIntelligenceSettings
  };
}
