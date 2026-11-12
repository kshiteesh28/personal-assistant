import Foundation

/// Sample-accurate word span scheduled onto `AVAudioPlayerNode`.
public struct ScheduledWordSpan: Equatable, Sendable {
    public let clauseIndex: Int
    public let outputFrameStart: Int64
    public let outputFrameEnd: Int64
    public let globalCharStart: Int
    public let globalCharEnd: Int
    public let word: String

    public init(
        clauseIndex: Int,
        outputFrameStart: Int64,
        outputFrameEnd: Int64,
        globalCharStart: Int,
        globalCharEnd: Int,
        word: String
    ) {
        self.clauseIndex = clauseIndex
        self.outputFrameStart = outputFrameStart
        self.outputFrameEnd = max(outputFrameStart, outputFrameEnd)
        self.globalCharStart = globalCharStart
        self.globalCharEnd = max(globalCharStart, globalCharEnd)
        self.word = word
    }
}

/// Tracks synthesized clauses and maps real-time `AVAudioPlayerNode` sample frame positions
/// to exact global character offsets (`spokenCharIndex`), preventing the faster-than-real-time
/// `AVSpeechSynthesizer.write` callback from prematurely marking unspoken text as heard.
public struct ScheduledWordLedger: Sendable {
    public private(set) var spans: [ScheduledWordSpan] = []
    public private(set) var totalScheduledFrames: Int64 = 0
    public private(set) var activeClauseTexts: [Int: String] = [:]

    public init() {}

    public mutating func reset() {
        spans.removeAll()
        totalScheduledFrames = 0
        activeClauseTexts.removeAll()
    }

    public mutating func registerClause(
        clauseIndex: Int,
        charStart: Int,
        text: String,
        estimatedDurationFrames: Int64,
        startFrameOffset: Int64? = nil
    ) {
        let baseFrame = startFrameOffset ?? totalScheduledFrames
        activeClauseTexts[clauseIndex] = text
        let nsText = text as NSString
        let totalLength = nsText.length
        guard totalLength > 0, estimatedDurationFrames > 0 else { return }

        var searchRange = NSRange(location: 0, length: totalLength)
        while searchRange.location < totalLength {
            let remaining = text.index(text.startIndex, offsetBy: searchRange.location)..<text.endIndex
            guard let wordRange = text.range(of: "\\S+", options: .regularExpression, range: remaining) else { break }
            let nsWordRange = NSRange(wordRange, in: text)
            let wordString = nsText.substring(with: nsWordRange)
            let startFraction = Double(nsWordRange.location) / Double(totalLength)
            let endFraction = Double(nsWordRange.location + nsWordRange.length) / Double(totalLength)
            let frameStart = baseFrame + Int64(( Double(estimatedDurationFrames) * startFraction ).rounded(.down))
            let frameEnd = baseFrame + Int64(( Double(estimatedDurationFrames) * endFraction ).rounded(.up))
            spans.append(
                ScheduledWordSpan(
                    clauseIndex: clauseIndex,
                    outputFrameStart: frameStart,
                    outputFrameEnd: frameEnd,
                    globalCharStart: charStart + nsWordRange.location,
                    globalCharEnd: charStart + nsWordRange.location + nsWordRange.length,
                    word: wordString
                )
            )
            let nextLoc = nsWordRange.location + nsWordRange.length
            searchRange = NSRange(location: nextLoc, length: max(0, totalLength - nextLoc))
        }
        totalScheduledFrames = max(totalScheduledFrames, baseFrame + estimatedDurationFrames)
    }

    public mutating func appendMarkerSpan(_ span: ScheduledWordSpan) {
        spans.append(span)
        totalScheduledFrames = max(totalScheduledFrames, span.outputFrameEnd)
    }

    /// Binary-searches the scheduled word spans to find the exact character index that has
    /// physically exited `AVAudioPlayerNode` at `sampleTime`.
    public func spokenCharIndex(atSampleTime sampleTime: Int64) -> Int {
        guard sampleTime > 0, !spans.isEmpty else { return 0 }
        var low = 0
        var high = spans.count - 1
        var bestIndex = -1
        while low <= high {
            let mid = (low + high) / 2
            if spans[mid].outputFrameStart <= sampleTime {
                bestIndex = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return bestIndex >= 0 ? spans[bestIndex].globalCharEnd : 0
    }

    public var combinedPlayingText: String {
        activeClauseTexts.keys.sorted().compactMap { activeClauseTexts[$0] }.joined(separator: " ")
    }
}

/// Pure, deterministic Two-Stage Barge-In & Pre-Speech Continuation State Machine (`0.7.0`).
public struct BargeInPolicy: Sendable {
    public enum Phase: String, Equatable, Sendable {
        case idle
        case listening
        case thinkingPreSpeech
        case speakingFullDuplex
        case duckingCandidate
        case bargeInCutThrough
    }

    public enum Decision: Equatable, Sendable {
        case none
        case duckOutputVolume(Float)
        case restoreOutputVolume(Float)
        case stitchPreSpeechContinuation(turnId: String)
        case cutThroughBargeIn(turnId: String, spokenCharIndex: Int, reason: String)
    }

    public static let priorityInterruptWords: Set<String> = [
        "stop", "wait", "no", "hold", "cancel", "actually", "pause", "kst", "arise", "total", "shutdown"
    ]

    public private(set) var phase: Phase = .idle
    public private(set) var activeTurnId: String?
    public private(set) var voiceEnergyStartUptime: Double?
    public var stage1DuckMs: Double = 120.0
    public var stage2CutThroughMs: Double = 200.0

    public init(headphonesConnected: Bool = false) {
        configureRoute(headphonesConnected: headphonesConnected)
    }

    public mutating func configureRoute(headphonesConnected: Bool) {
        stage1DuckMs = headphonesConnected ? 90.0 : 120.0
        stage2CutThroughMs = headphonesConnected ? 150.0 : 200.0
    }

    public mutating func beginListening() {
        phase = .listening
        activeTurnId = nil
        voiceEnergyStartUptime = nil
    }

    public mutating func beginThinking(turnId: String) {
        phase = .thinkingPreSpeech
        activeTurnId = turnId
        voiceEnergyStartUptime = nil
    }

    public mutating func beginSpeaking(turnId: String) {
        phase = .speakingFullDuplex
        activeTurnId = turnId
        voiceEnergyStartUptime = nil
    }

    public mutating func finishSpeaking() {
        phase = .listening
        activeTurnId = nil
        voiceEnergyStartUptime = nil
    }

    /// Evaluates post-AEC voice energy and partial transcription tokens to decide whether
    /// to stitch a pre-speech continuation, duck speaker volume, restore volume on a brief cough,
    /// or commit a hard `<15ms` barge-in cut-through.
    public mutating func evaluate(
        nowUptime: Double,
        hasVoiceEnergy: Bool,
        partialTranscript: String,
        currentlyPlayingText: String,
        currentSampleTime: Int64,
        ledger: ScheduledWordLedger
    ) -> Decision {
        guard let turnId = activeTurnId else { return .none }

        let cleanedPartial = partialTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstWords = Self.normalizedTokens(cleanedPartial)
        let hasPriorityWord = firstWords.contains { Self.priorityInterruptWords.contains($0) }
        let isEcho = !cleanedPartial.isEmpty && !hasPriorityWord && Self.isLikelySelfEcho(
            transcript: cleanedPartial,
            currentlyPlayingText: currentlyPlayingText
        )

        // Scenario A: User resumes speaking during `thinkingPreSpeech` (before any TTS audio played)
        if phase == .thinkingPreSpeech {
            if !cleanedPartial.isEmpty && !isEcho {
                phase = .listening
                activeTurnId = nil
                return .stitchPreSpeechContinuation(turnId: turnId)
            }
            return .none
        }

        guard phase == .speakingFullDuplex || phase == .duckingCandidate else { return .none }

        // Immediate cut-through on priority interrupt word ("stop", "wait", "no", "hold", "cancel")
        if hasPriorityWord {
            phase = .bargeInCutThrough
            let charIdx = ledger.spokenCharIndex(atSampleTime: currentSampleTime)
            return .cutThroughBargeIn(turnId: turnId, spokenCharIndex: charIdx, reason: "user_barge_in")
        }

        if hasVoiceEnergy && !isEcho {
            let start = voiceEnergyStartUptime ?? nowUptime
            voiceEnergyStartUptime = start
            let elapsedMs = (nowUptime - start) * 1000.0

            if elapsedMs >= stage2CutThroughMs && !firstWords.isEmpty {
                phase = .bargeInCutThrough
                let charIdx = ledger.spokenCharIndex(atSampleTime: currentSampleTime)
                return .cutThroughBargeIn(turnId: turnId, spokenCharIndex: charIdx, reason: "user_barge_in")
            }

            if phase == .speakingFullDuplex && elapsedMs >= stage1DuckMs {
                phase = .duckingCandidate
                return .duckOutputVolume(0.15)
            }
            return .none
        } else {
            // Voice energy stopped or was classified as residual self-echo
            if !firstWords.isEmpty && !isEcho {
                phase = .bargeInCutThrough
                let charIdx = ledger.spokenCharIndex(atSampleTime: currentSampleTime)
                return .cutThroughBargeIn(turnId: turnId, spokenCharIndex: charIdx, reason: "user_barge_in")
            }
            if phase == .duckingCandidate {
                phase = .speakingFullDuplex
                voiceEnergyStartUptime = nil
                return .restoreOutputVolume(1.0)
            }
            voiceEnergyStartUptime = nil
            return .none
        }
    }

    /// Defense-in-depth self-echo filter: returns `true` if `transcript` shares >= 40% of its tokens
    /// (or >= 2 substantive words of >= 4 characters) with `currentlyPlayingText`, and contains
    /// no priority interrupt word. This prevents built-in speaker bleed from causing self-conversation loops.
    public static func isLikelySelfEcho(transcript: String, currentlyPlayingText: String) -> Bool {
        let candidateTokens = normalizedTokens(transcript)
        guard !candidateTokens.isEmpty else { return false }
        if candidateTokens.contains(where: { priorityInterruptWords.contains($0) }) {
            return false
        }
        let referenceTokens = Set(normalizedTokens(currentlyPlayingText))
        guard !referenceTokens.isEmpty else { return false }
        let matched = candidateTokens.filter { referenceTokens.contains($0) }.count
        if Double(matched) / Double(candidateTokens.count) >= 0.40 {
            return true
        }
        let substantiveMatches = candidateTokens.filter { $0.count >= 4 && referenceTokens.contains($0) }.count
        return substantiveMatches >= 2
    }

    public static func normalizedTokens(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }
}

// MARK: - Real-Time Voice-Band Noise Suppressor & Target Speaker Voice Identifier

/// Aggregated acoustic telemetry for an active speech recognition turn.
public struct UtteranceAcousticSummary: Equatable, Sendable {
    public let frameCount: Int
    public let speechFrameCount: Int
    public let peakSnrDb: Double
    public let meanSnrDb: Double
    public let meanSpeechBandRatio: Double
    public let meanF0Hz: Double
    public let f0StdDevSemitones: Double
    public let meanNearFieldRMS: Double

    public init(
        frameCount: Int = 0,
        speechFrameCount: Int = 0,
        peakSnrDb: Double = 0,
        meanSnrDb: Double = 0,
        meanSpeechBandRatio: Double = 1.0,
        meanF0Hz: Double = 0,
        f0StdDevSemitones: Double = 0,
        meanNearFieldRMS: Double = 0
    ) {
        self.frameCount = frameCount
        self.speechFrameCount = speechFrameCount
        self.peakSnrDb = peakSnrDb
        self.meanSnrDb = meanSnrDb
        self.meanSpeechBandRatio = meanSpeechBandRatio
        self.meanF0Hz = meanF0Hz
        self.f0StdDevSemitones = f0StdDevSemitones
        self.meanNearFieldRMS = meanNearFieldRMS
    }
}

/// Real-time 95 Hz – 3600 Hz speech band-pass filter and lag-autocorrelation fundamental pitch (`F0`) tracker.
/// Never chops or hard-gates active user speech mid-sentence so `SFSpeechRecognizer` never prematurely
/// cuts off the speaker.
public struct VoiceAudioProcessor: Sendable {
    // 1st-order high-pass (~95 Hz) & low-pass (~3600 Hz) cascade state
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var lpPrevOut: Float = 0

    public private(set) var noiseFloorRMS: Double = 0.0020
    public private(set) var lastVocalActivityUptime: Double = 0
    private var totalFrames: Int = 0
    private var speechFrames: Int = 0
    private var peakSnrDb: Double = 0
    private var snrDbSum: Double = 0
    private var speechBandRatioSum: Double = 0
    private var nearFieldRMSSum: Double = 0
    private var f0SamplesHz: [Double] = []

    public init() {}

    public mutating func resetTurnMetrics() {
        totalFrames = 0
        speechFrames = 0
        peakSnrDb = 0
        snrDbSum = 0
        speechBandRatioSum = 0
        nearFieldRMSSum = 0
        f0SamplesHz.removeAll(keepingCapacity: true)
    }

    /// Filters a mono float buffer in-place to strip sub-bass music (<95 Hz) and high-hat/synth
    /// treble (>3600 Hz) without muting human speech syllables mid-sentence.
    /// Returns `true` if the frame contains near-field target speech energy.
    @discardableResult
    public mutating func processMonoFrame(_ samples: UnsafeMutableBufferPointer<Float>, sampleRate: Double) -> Bool {
        let count = samples.count
        guard count > 0, sampleRate > 0 else { return false }

        let dt = Float(1.0 / sampleRate)
        let rcHigh = Float(1.0 / (2.0 * Double.pi * 95.0))
        let alphaHigh = rcHigh / (rcHigh + dt)
        let rcLow = Float(1.0 / (2.0 * Double.pi * 3600.0))
        let alphaLow = dt / (rcLow + dt)

        var rawSumSq: Double = 0
        var bandSumSq: Double = 0

        for i in 0..<count {
            let x = samples[i]
            rawSumSq += Double(x * x)
            let hp = alphaHigh * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp
            let bp = lpPrevOut + alphaLow * (hp - lpPrevOut)
            lpPrevOut = bp
            samples[i] = bp
            bandSumSq += Double(bp * bp)
        }

        let rawRMS = sqrt(rawSumSq / Double(count))
        let bandRMS = sqrt(bandSumSq / Double(count))
        let bandRatio = rawRMS > 1e-6 ? min(1.0, bandRMS / rawRMS) : 1.0

        // Only adapt noiseFloorRMS during quiet ambient frames so the user's continuous voice
        // never raises the noise floor against itself mid-sentence.
        if bandRMS < noiseFloorRMS {
            noiseFloorRMS = 0.85 * noiseFloorRMS + 0.15 * max(0.0008, bandRMS)
        } else if bandRMS < 0.0075 {
            noiseFloorRMS = min(0.0065, 0.9992 * noiseFloorRMS + 0.0008 * bandRMS)
        }

        let snrDb = 20.0 * log10(max(bandRMS, 1e-6) / max(noiseFloorRMS, 0.0008))
        totalFrames += 1

        let isNearFieldSpeechCandidate = snrDb >= 3.8 && bandRatio >= 0.48 && bandRMS >= 0.0032
        if isNearFieldSpeechCandidate {
            speechFrames += 1
            lastVocalActivityUptime = ProcessInfo.processInfo.systemUptime
            peakSnrDb = max(peakSnrDb, snrDb)
            snrDbSum += snrDb
            speechBandRatioSum += bandRatio
            nearFieldRMSSum += bandRMS
            if let f0 = Self.estimateFundamentalPitchHz(samples: samples, sampleRate: sampleRate) {
                if f0SamplesHz.count < 256 {
                    f0SamplesHz.append(f0)
                }
            }
        } else if speechFrames == 0 && bandRatio < 0.38 && snrDb < 2.0 {
            // Only attenuate pure out-of-band bass/treble rumble BEFORE any speech has started in the turn,
            // never while the user is mid-sentence.
            for i in 0..<count {
                samples[i] *= 0.25
            }
        }

        return isNearFieldSpeechCandidate
    }

    public func currentSummary() -> UtteranceAcousticSummary {
        guard speechFrames > 0 else {
            return UtteranceAcousticSummary(frameCount: totalFrames, speechFrameCount: 0, peakSnrDb: peakSnrDb)
        }
        let meanSnr = snrDbSum / Double(speechFrames)
        let meanBandRatio = speechBandRatioSum / Double(speechFrames)
        let meanRMS = nearFieldRMSSum / Double(speechFrames)
        let (meanF0, stdSemitones) = Self.pitchStatistics(f0SamplesHz)
        return UtteranceAcousticSummary(
            frameCount: totalFrames,
            speechFrameCount: speechFrames,
            peakSnrDb: peakSnrDb,
            meanSnrDb: meanSnr,
            meanSpeechBandRatio: meanBandRatio,
            meanF0Hz: meanF0,
            f0StdDevSemitones: stdSemitones,
            meanNearFieldRMS: meanRMS
        )
    }

    /// Estimates fundamental speaking frequency (`F0` in `75 Hz ... 300 Hz`) using lag autocorrelation.
    public static func estimateFundamentalPitchHz(samples: UnsafeMutableBufferPointer<Float>, sampleRate: Double) -> Double? {
        let n = min(samples.count, 512)
        guard n >= 256 else { return nil }
        let minLag = max(1, Int(sampleRate / 300.0))
        let maxLag = min(n / 2, Int(sampleRate / 75.0))
        guard minLag < maxLag else { return nil }

        var energy0: Float = 0
        for i in 0..<n {
            energy0 += samples[i] * samples[i]
        }
        guard energy0 > 1e-5 else { return nil }

        var bestLag = minLag
        var bestCorr: Float = -1.0
        let step = sampleRate >= 32_000 ? 2 : 1

        var lag = minLag
        while lag <= maxLag {
            var corr: Float = 0
            var energyLag: Float = 0
            let limit = n - lag
            for i in 0..<limit {
                let a = samples[i]
                let b = samples[i + lag]
                corr += a * b
                energyLag += b * b
            }
            let denom = sqrt(energy0 * max(energyLag, 1e-6))
            let norm = denom > 0 ? corr / denom : 0
            if norm > bestCorr {
                bestCorr = norm
                bestLag = lag
            }
            lag += step
        }

        guard bestCorr >= 0.48 else { return nil }
        return sampleRate / Double(bestLag)
    }

    public static func pitchStatistics(_ f0Values: [Double]) -> (meanHz: Double, stdDevSemitones: Double) {
        guard !f0Values.isEmpty else { return (0, 0) }
        let sorted = f0Values.sorted()
        let median = sorted[sorted.count / 2]
        let clean = sorted.filter { val in
            guard val > 0, median > 0 else { return false }
            return abs(12.0 * log2(val / median)) <= 9.5
        }
        let active = clean.isEmpty ? sorted : clean
        let meanHz = active.reduce(0.0, +) / Double(active.count)
        guard active.count >= 2, meanHz > 0 else { return (meanHz, 0) }
        let varianceSemitones = active.reduce(0.0) { acc, hz in
            let semi = 12.0 * log2(max(hz, 1.0) / meanHz)
            return acc + semi * semi
        } / Double(active.count)
        return (meanHz, sqrt(varianceSemitones))
    }
}

/// Identifies the primary near-field speaking user and rejects background music lyrics
/// or distant/melodic vocals.
public struct SpeakerVoiceIdentifier: Sendable {
    public struct Verdict: Equatable, Sendable {
        public let accepted: Bool
        public let reason: String
        public let speakerLocked: Bool
        public let enrolledF0Hz: Double

        public init(accepted: Bool, reason: String, speakerLocked: Bool, enrolledF0Hz: Double) {
            self.accepted = accepted
            self.reason = reason
            self.speakerLocked = speakerLocked
            self.enrolledF0Hz = enrolledF0Hz
        }
    }

    public private(set) var enrolledF0Hz: Double = 0
    public private(set) var enrolledNearFieldRMS: Double = 0
    public private(set) var enrolledSamplesCount: Int = 0

    public var isSpeakerLocked: Bool {
        enrolledSamplesCount > 0 && enrolledF0Hz >= 75.0
    }

    public init() {}

    public mutating func enrollOrUpdate(summary: UtteranceAcousticSummary) {
        guard summary.speechFrameCount >= 2,
              summary.peakSnrDb >= 5.0,
              summary.meanSpeechBandRatio >= 0.55 else { return }

        if summary.meanF0Hz >= 75.0 && summary.meanF0Hz <= 300.0 && summary.f0StdDevSemitones <= 4.0 {
            if enrolledSamplesCount == 0 {
                enrolledF0Hz = summary.meanF0Hz
                enrolledNearFieldRMS = max(0.008, summary.meanNearFieldRMS)
                enrolledSamplesCount = 1
            } else {
                enrolledF0Hz = 0.78 * enrolledF0Hz + 0.22 * summary.meanF0Hz
                enrolledNearFieldRMS = 0.78 * enrolledNearFieldRMS + 0.22 * max(0.008, summary.meanNearFieldRMS)
                enrolledSamplesCount += 1
            }
        }
    }

    public mutating func evaluateUtterance(
        transcript: String,
        wakePhrase: String,
        summary: UtteranceAcousticSummary,
        averageSegmentConfidence: Float? = nil
    ) -> Verdict {
        let cleaned = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else {
            return Verdict(accepted: false, reason: "empty_transcript", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
        }

        if VoiceControl.isTotalShutdown(cleaned) || VoiceControl.isStop(cleaned) {
            return Verdict(accepted: true, reason: "priority_control_phrase", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
        }
        if let wakeRemainder = WakeGate.command(in: cleaned, phrase: wakePhrase) {
            enrollOrUpdate(summary: summary)
            return Verdict(
                accepted: true,
                reason: wakeRemainder.isEmpty ? "wake_phrase_enrolled" : "wake_command_enrolled",
                speakerLocked: isSpeakerLocked,
                enrolledF0Hz: enrolledF0Hz
            )
        }

        if summary.frameCount >= 4 {
            if summary.speechFrameCount == 0 || summary.peakSnrDb < 4.5 {
                return Verdict(accepted: false, reason: "background_noise_or_music_floor", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
            }
            if summary.meanSpeechBandRatio < 0.52 {
                return Verdict(accepted: false, reason: "music_bass_treble_spectrum", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
            }
        }

        if summary.f0StdDevSemitones > 4.4 {
            return Verdict(accepted: false, reason: "melodic_singing_pitch_variance", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
        }

        if isSpeakerLocked && summary.meanF0Hz >= 75.0 {
            let semitoneDelta = abs(12.0 * log2(summary.meanF0Hz / enrolledF0Hz))
            let energyRatio = enrolledNearFieldRMS > 0 ? (summary.meanNearFieldRMS / enrolledNearFieldRMS) : 1.0
            if semitoneDelta > 5.8 || (semitoneDelta > 4.2 && energyRatio < 0.50) {
                return Verdict(accepted: false, reason: "speaker_voice_mismatch", speakerLocked: true, enrolledF0Hz: enrolledF0Hz)
            }
        }

        if let conf = averageSegmentConfidence, conf > 0.0, conf < 0.30, summary.peakSnrDb < 9.0 {
            return Verdict(accepted: false, reason: "low_confidence_lyric_hallucination", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
        }

        if summary.peakSnrDb >= 7.0 && summary.f0StdDevSemitones <= 3.6 {
            enrollOrUpdate(summary: summary)
        }

        return Verdict(accepted: true, reason: "verified_target_speaker", speakerLocked: isSpeakerLocked, enrolledF0Hz: enrolledF0Hz)
    }
}

/// Bootstrap payload passed from `kst.app` to the supervised Node.js core over `stdin`.
public struct NativeBrokerBootstrap: Codable, Sendable, Equatable {
    public let schemaVersion: Int
    public let socketPath: String
    public let capability: String

    public init(schemaVersion: Int = 1, socketPath: String, capability: String) {
        self.schemaVersion = schemaVersion
        self.socketPath = socketPath
        self.capability = capability
    }
}
