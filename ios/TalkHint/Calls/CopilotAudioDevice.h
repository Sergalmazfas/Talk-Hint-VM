//
//  CopilotAudioDevice.h
//
//  Based on Twilio's MIT-licensed ExampleAVAudioEngineDevice sample
//  (Copyright © 2018-2020 Twilio, Inc.).  Copilot-specific routing is kept
//  here so the normal CallKit/Twilio audio path does not need a second device.
//
//  MIT License
//  Copyright © 2018-2020 Twilio, Inc.
//  Permission is hereby granted, free of charge, to any person obtaining a
//  copy of this software and associated documentation files (the "Software"),
//  to deal in the Software without restriction, including without limitation
//  the rights to use, copy, modify, merge, publish, distribute, sublicense,
//  and/or sell copies of the Software, and to permit persons to whom the
//  Software is furnished to do so, subject to the following conditions:
//  The above copyright notice and this permission notice shall be included in
//  all copies or substantial portions of the Software.
//  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//  THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//  FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//  DEALINGS IN THE SOFTWARE.
//

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <stdatomic.h>

@import TwilioVoice;

NS_ASSUME_NONNULL_BEGIN

typedef void (^CopilotAudioPCMCallback)(const void *bytes,
                                         NSUInteger byteCount,
                                         NSUInteger frameCount,
                                         TVOAudioFormat *format,
                                         uint64_t privateEpoch);

/**
 * The single audio device used by Copilot calls.  It is installed before a
 * call is connected and remains installed for the call's lifetime.
 *
 * Captured bytes are copied before the gate and delivered only to
 * `capturedPCM`. Render bytes are copied immediately after
 * TVOAudioDeviceReadRenderData and delivered only to `remotePCM`. Delivery is
 * asynchronous and never runs user code on an audio callback thread.
 */
NS_CLASS_AVAILABLE(NA, 11_0)
@interface CopilotAudioDevice : NSObject <TVOAudioDevice>

@property (nonatomic, assign, getter=isEnabled) BOOL enabled;
@property (nonatomic, copy, nullable) CopilotAudioPCMCallback capturedPCM;
@property (nonatomic, copy, nullable) CopilotAudioPCMCallback remotePCM;
@property (nonatomic, copy, nullable) void (^formatDidChange)(TVOAudioFormat *format);

/// A monotonically increasing frame-boundary token.  The returned token is
/// acknowledged only after a subsequent capture callback has applied silence.
- (uint64_t)closeOwnerUplinkAtFrameBoundary;
- (BOOL)isOwnerUplinkClosed;
- (BOOL)waitForOwnerUplinkClosed:(uint64_t)token timeout:(NSTimeInterval)timeout
    NS_SWIFT_NAME(wait(forOwnerUplinkClosed:timeout:));
- (BOOL)waitForPrivateDrain:(uint64_t)token timeout:(NSTimeInterval)timeout
    NS_SWIFT_NAME(wait(forPrivateDrain:timeout:));
/// Stops accepting private frames for this epoch at the next capture
/// boundary. The uplink remains silent; this never opens the gate.
- (void)finishPrivateCaptureAtFrameBoundary:(uint64_t)epoch
    NS_SWIFT_NAME(finishPrivateCapture(atFrameBoundary:));
- (BOOL)openOwnerUplink;
/// True only after a valid public capture frame was handed to Twilio following
/// this hold's drain. A timeout must fail closed, not display Ready.
- (BOOL)waitForOwnerUplinkOpen:(uint64_t)epoch timeout:(NSTimeInterval)timeout
    NS_SWIFT_NAME(wait(forOwnerUplinkOpen:timeout:));
/// Resets per-call privacy state. Call only before a new call is connected.
- (void)prepareForNewCall;

/// Plays pre-synthesized mono PCM16 through Twilio's capture path, replacing
/// the Owner microphone while active. The data is copied/resampled before the
/// realtime callback; playback is bounded and callbacks are delivered off it.
- (BOOL)startCopilotPlayback:(NSData *)pcm16 sampleRate:(double)sampleRate firstAudio:(void (^)(void))firstAudio completion:(void (^)(BOOL))completion
    NS_SWIFT_NAME(startCopilotPlayback(_:sampleRate:firstAudio:completion:));
- (void)stopCopilotPlayback;

/// Marks the device safe without waiting for a potentially interrupted audio
/// callback.  Private mode must remain closed until the caller explicitly
/// opens it.
- (void)audioInterrupted;

@end

NS_ASSUME_NONNULL_END