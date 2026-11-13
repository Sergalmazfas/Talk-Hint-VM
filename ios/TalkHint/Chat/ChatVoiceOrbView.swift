import SwiftUI

/// Visual component only. Does not own an audio session, record, play, or send requests.
/// The voice controller supplies its actual state and normalized microphone/playback level.
struct ChatVoiceOrbView: View {
    enum Phase: CaseIterable, Equatable {
        case idle, listening, thinking, speaking, unavailable
    }

    let phase: Phase
    var level: Double = 0
    // Allows the native tests and previews to exercise iOS 15's renderer on a newer OS.
    var forceFallback = false
    // Render-fixture override: nil preserves the system accessibility setting in the app.
    var reduceMotionOverride: Bool? = nil
    // UIKit hosting does not always inherit the window scene's active environment.
    // The real controller provides foreground visibility, not synthetic audio levels.
    var screenActive: Bool? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var effectiveReduceMotion: Bool { reduceMotionOverride ?? reduceMotion }
    var active: Bool { screenActive ?? (scenePhase == .active) }

    static func boundedLevel(_ value: Double) -> Double {
        value.isFinite ? min(1, max(0, value)) : 0
    }

    static func scale(phase: Phase, level: Double) -> CGFloat {
        switch phase {
        case .listening, .speaking:
            return CGFloat(0.92 + boundedLevel(level) * 0.08)
        case .idle, .thinking, .unavailable:
            return 0.92
        }
    }

    var body: some View {
        // A quiet listening pulse is a state indicator, NOT a simulated microphone level.
        TimelineView(.animation(minimumInterval: 1.0 / 30.0,
                                paused: effectiveReduceMotion || !active || phase != .listening)) { context in
            let pulse = active && !effectiveReduceMotion && phase == .listening
                ? CGFloat((sin(context.date.timeIntervalSinceReferenceDate * 3) + 1) * 0.012) : 0
            artwork
                .aspectRatio(1, contentMode: .fit)
                .scaleEffect(effectiveReduceMotion ? 0.92 : Self.scale(phase: phase, level: level) + pulse)
        }
            // The containing screen provides localized state text, not a second VoiceOver element.
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    @ViewBuilder private var artwork: some View {
        if #available(iOS 17, *), !forceFallback, !effectiveReduceMotion,
           active, phase != .idle, phase != .unavailable {
            OrbView(configuration: OrbConfiguration(
                backgroundColors: colors,
                glowColor: .blue,
                coreGlowIntensity: phase == .speaking ? 1.1 : 0.7,
                // Avoid rebuilding SpriteKit particle scenes for each audio-level sample.
                showParticles: false,
                showShadow: false,
                speed: phase == .thinking ? 25 : 45
            ))
        } else {
            ChatVoiceFallbackCircle(
                colors: colors,
                pulsing: !effectiveReduceMotion && active
                    && phase != .idle && phase != .unavailable,
                thinking: phase == .thinking
            )
        }
    }

    private var colors: [Color] {
        switch phase {
        case .idle, .unavailable: return [.black, .gray]
        case .listening: return [.indigo, .blue]
        case .thinking: return [.indigo, .purple]
        case .speaking: return [.blue, .cyan]
        }
    }
}

/// iOS 15–16 fallback: no Orb symbols, newer APIs, or audio ownership.
private struct ChatVoiceFallbackCircle: View {
    let colors: [Color]
    let pulsing: Bool
    let thinking: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !pulsing)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            let wave = pulsing ? (sin(time * (thinking ? 2 : 3)) + 1) / 2 : 0
            Circle()
                .fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
                .opacity(0.85 + wave * 0.15)
                .scaleEffect(0.94 + wave * 0.06)
        }
    }
}

#if DEBUG
/// Open this file's Canvas in Xcode. These are visual fixtures, not a running voice session.
struct ChatVoiceOrbView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ChatVoiceOrbView(phase: .listening, level: 0.5)
                .previewDisplayName("Orb · iOS 17+")
            ChatVoiceOrbView(phase: .thinking, forceFallback: true)
                .previewDisplayName("Circle · iOS 15–16")
            ChatVoiceOrbView(phase: .speaking, level: 0.7)
                .preferredColorScheme(.dark)
                .previewDisplayName("Orb · Dark")
        }
        .frame(width: 240, height: 240)
        .padding(40)
        .background(Color(uiColor: .systemBackground))
        .previewLayout(.sizeThatFits)
    }
}
#endif
