//
//  CopilotAudioDevice.m
//
//  Portions of the audio-unit setup are derived from Twilio's
//  ExampleAVAudioEngineDevice.m, Copyright © 2018-2020 Twilio, Inc.,
//  released under the MIT License.  The original notice and reference are
//  retained here rather than copied into the application call manager.
//

#import "CopilotAudioDevice.h"
#import "CopilotHoldGate.h"
#import <AudioToolbox/AudioToolbox.h>
#import <math.h>
#import <limits.h>
#import <time.h>
#import <unistd.h>

static const UInt32 kBusOutput = 0;
static const UInt32 kBusInput = 1;
static const UInt32 kMaxFrames = 3072;
static const UInt32 kChannels = 1;
static const UInt32 kBytesPerSample = 2;
static const UInt32 kRingSlots = 32;
// Fixed-capacity storage keeps the realtime path allocation-free. At 48 kHz
// this permits two minutes of speech; higher output rates shorten that bound.
static const UInt64 kMaxPlaybackSamples = 5760000;
static const UInt32 kPlaybackFirstEvent = 1;
static const UInt32 kPlaybackDoneEvent = 2;
static char kCopilotDrainQueueKey;

typedef struct {
    _Atomic(bool) ready;
    UInt32 frames;
    UInt32 bytes;
    uint64_t epoch;
    uint8_t *data;
} CopilotAudioSlot;

typedef struct {
    _Atomic(UInt32) writeIndex;
    _Atomic(UInt32) readIndex;
    CopilotAudioSlot slots[kRingSlots];
} CopilotAudioRing;

static void CopilotRingInit(CopilotAudioRing *ring) {
    atomic_init(&ring->writeIndex, 0);
    atomic_init(&ring->readIndex, 0);
    for (UInt32 i = 0; i < kRingSlots; i++) {
        atomic_init(&ring->slots[i].ready, false);
        ring->slots[i].frames = 0;
        ring->slots[i].bytes = 0;
        ring->slots[i].data = calloc(kMaxFrames, kChannels * kBytesPerSample);
    }
}

static void CopilotRingDestroy(CopilotAudioRing *ring) {
    for (UInt32 i = 0; i < kRingSlots; i++) free(ring->slots[i].data);
}

// Single-producer/single-consumer: capture and render each have their own ring.
static bool CopilotRingPush(CopilotAudioRing *ring, const void *bytes, UInt32 byteCount, UInt32 frames,
                            uint64_t epoch) {
    UInt32 write = atomic_load_explicit(&ring->writeIndex, memory_order_relaxed);
    CopilotAudioSlot *slot = &ring->slots[write % kRingSlots];
    if (atomic_load_explicit(&slot->ready, memory_order_acquire)) return false;
    if (byteCount > kMaxFrames * kChannels * kBytesPerSample) return false;
    memcpy(slot->data, bytes, byteCount);
    slot->bytes = byteCount;
    slot->frames = frames;
    slot->epoch = epoch;
    atomic_store_explicit(&slot->ready, true, memory_order_release);
    atomic_store_explicit(&ring->writeIndex, write + 1, memory_order_release);
    return true;
}

static bool CopilotRingPop(CopilotAudioRing *ring, const void **bytes, UInt32 *byteCount, UInt32 *frames,
                           uint64_t *epoch) {
    UInt32 read = atomic_load_explicit(&ring->readIndex, memory_order_relaxed);
    CopilotAudioSlot *slot = &ring->slots[read % kRingSlots];
    if (!atomic_load_explicit(&slot->ready, memory_order_acquire)) return false;
    *bytes = slot->data;
    *byteCount = slot->bytes;
    *frames = slot->frames;
    *epoch = slot->epoch;
    return true;
}
static void CopilotRingRelease(CopilotAudioRing *ring) {
    UInt32 read = atomic_load_explicit(&ring->readIndex, memory_order_relaxed);
    atomic_store_explicit(&ring->slots[read % kRingSlots].ready, false, memory_order_release);
    atomic_store_explicit(&ring->readIndex, read + 1, memory_order_release);
}

@interface CopilotAudioDevice () {
@public
    AudioUnit _audioUnit;
    AudioBufferList _captureBuffer;
    uint8_t *_captureBytes;
    CopilotAudioRing _capturedRing;
    CopilotAudioRing _remoteRing;
    dispatch_queue_t _drainQueue;
    _Atomic(bool) _drainScheduled;
    _Atomic(bool) _ownerUplinkClosed;
    _Atomic(uint64_t) _closeToken;
    _Atomic(uint64_t) _ackToken;
    _Atomic(uint64_t) _privateDrainedToken;
    _Atomic(bool) _finishRequested;
    _Atomic(uint64_t) _finishEpoch;
    _Atomic(uint64_t) _finishAckEpoch;
    _Atomic(UInt32) _finishFenceWriteIndex;
    _Atomic(uint64_t) _openPendingEpoch;
    _Atomic(uint64_t) _openAckEpoch;
    _Atomic(bool) _interrupted;
    _Atomic(bool) _forcedFailClosed;
    _Atomic(bool) _enabled;
    _Atomic(bool) _captureTapEnabled;
    _Atomic(bool) _remoteTapEnabled;
    int16_t *_playbackSamples;
    _Atomic(bool) _playbackActive;
    _Atomic(bool) _playbackMutating;
    _Atomic(UInt32) _playbackReaders;
    _Atomic(UInt64) _playbackCount;
    _Atomic(UInt64) _playbackCaptureCursor;
    _Atomic(UInt64) _playbackMonitorCursor;
    _Atomic(UInt64) _playbackGeneration;
    _Atomic(UInt64) _playbackEventGeneration;
    _Atomic(UInt32) _playbackEvents;
    void (^_playbackFirstAudio)(void);
    void (^_playbackCompletion)(BOOL);
    BOOL _playbackFirstCallbackDelivered;
    NSLock *_playbackControlLock;
    TVOAudioDeviceContext _capturingContext;
    TVOAudioDeviceContext _renderingContext;
    TVOAudioFormat *_format;
}
@end

static OSStatus CopilotRenderCallback(void *, AudioUnitRenderActionFlags *,
                                      const AudioTimeStamp *, UInt32, UInt32,
                                      AudioBufferList *);
static OSStatus CopilotCaptureCallback(void *, AudioUnitRenderActionFlags *,
                                       const AudioTimeStamp *, UInt32, UInt32,
                                       AudioBufferList *);

static uint64_t CopilotMonotonicNanoseconds(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (uint64_t)now.tv_sec * 1000000000ULL + (uint64_t)now.tv_nsec;
}
static BOOL CopilotWaitUntil(NSTimeInterval timeout, BOOL (^condition)(void)) {
    uint64_t deadline = CopilotMonotonicNanoseconds() + (uint64_t)(timeout * 1000000000.0);
    for (;;) {
        if (condition()) return YES;
        if (CopilotMonotonicNanoseconds() >= deadline) return NO;
        usleep(1000);
    }
}

@implementation CopilotAudioDevice

- (instancetype)init {
    if ((self = [super init])) {
        _drainQueue = dispatch_queue_create("app.talkhint.copilot-audio-drain",
                                             DISPATCH_QUEUE_SERIAL);
        dispatch_queue_set_specific(_drainQueue, &kCopilotDrainQueueKey,
                                   &kCopilotDrainQueueKey, NULL);
        _playbackControlLock = [[NSLock alloc] init];
        atomic_init(&_drainScheduled, false);
        atomic_init(&_ownerUplinkClosed, false);
        atomic_init(&_closeToken, 0);
        atomic_init(&_ackToken, 0);
        atomic_init(&_privateDrainedToken, 0);
        atomic_init(&_finishRequested, false);
        atomic_init(&_finishEpoch, 0);
        atomic_init(&_finishAckEpoch, 0);
        atomic_init(&_finishFenceWriteIndex, 0);
        atomic_init(&_openPendingEpoch, 0);
        atomic_init(&_openAckEpoch, 0);
        atomic_init(&_interrupted, false);
        atomic_init(&_forcedFailClosed, false);
        atomic_init(&_enabled, true);
        atomic_init(&_captureTapEnabled, false);
        atomic_init(&_remoteTapEnabled, false);
        _playbackSamples = calloc((size_t)kMaxPlaybackSamples, sizeof(int16_t));
        atomic_init(&_playbackActive, false);
        atomic_init(&_playbackMutating, false);
        atomic_init(&_playbackReaders, 0);
        atomic_init(&_playbackCount, 0);
        atomic_init(&_playbackCaptureCursor, 0);
        atomic_init(&_playbackMonitorCursor, 0);
        atomic_init(&_playbackGeneration, 0);
        atomic_init(&_playbackEventGeneration, 0);
        atomic_init(&_playbackEvents, 0);
        CopilotRingInit(&_capturedRing);
        CopilotRingInit(&_remoteRing);
        _captureBytes = calloc(kMaxFrames, kChannels * kBytesPerSample);
        _captureBuffer.mNumberBuffers = 1;
        _captureBuffer.mBuffers[0].mNumberChannels = kChannels;
        _captureBuffer.mBuffers[0].mData = _captureBytes;
        [self configureSession];
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        [center addObserver:self selector:@selector(interruption:)
                       name:AVAudioSessionInterruptionNotification object:nil];
        [center addObserver:self selector:@selector(routeChange:)
                       name:AVAudioSessionRouteChangeNotification object:nil];
        [center addObserver:self selector:@selector(mediaReset:)
                       name:AVAudioSessionMediaServicesWereResetNotification object:nil];
    }
    return self;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
    [self stopUnit];
    CopilotRingDestroy(&_capturedRing);
    CopilotRingDestroy(&_remoteRing);
    free(_captureBytes);
    free(_playbackSamples);
}

- (void)configureSession {
    AVAudioSession *session = AVAudioSession.sharedInstance;
    NSError *error = nil;
    [session setCategory:AVAudioSessionCategoryPlayAndRecord mode:AVAudioSessionModeVoiceChat
                 options:AVAudioSessionCategoryOptionAllowBluetooth error:&error];
    [session setPreferredSampleRate:48000 error:&error];
    [session setPreferredIOBufferDuration:0.01 error:&error];
}

- (BOOL)isEnabled { return atomic_load_explicit(&_enabled, memory_order_acquire); }
- (void)setCapturedPCM:(CopilotAudioPCMCallback)callback {
    _capturedPCM = [callback copy];
    atomic_store_explicit(&_captureTapEnabled, callback != nil, memory_order_release);
}
- (void)setRemotePCM:(CopilotAudioPCMCallback)callback {
    _remotePCM = [callback copy];
    atomic_store_explicit(&_remoteTapEnabled, callback != nil, memory_order_release);
}
- (void)setEnabled:(BOOL)enabled {
    atomic_store_explicit(&_enabled, enabled, memory_order_release);
    // CallKit route/device disablement is not the Copilot private gate.
    atomic_store_explicit(&_forcedFailClosed, !enabled, memory_order_release);
    TVOAudioDeviceContext context = _capturingContext ?: _renderingContext;
    if (context) {
        TVOAudioDeviceExecuteWorkerBlock(context, ^{
            TVOAudioDeviceReinitialize(context);
        });
    }
}
- (void)prepareForNewCall {
    [self stopCopilotPlayback];
    atomic_store_explicit(&_ownerUplinkClosed, false, memory_order_release);
    atomic_store_explicit(&_forcedFailClosed, false, memory_order_release);
    atomic_store_explicit(&_interrupted, false, memory_order_release);
    atomic_store_explicit(&_ackToken, 0, memory_order_release);
    atomic_store_explicit(&_privateDrainedToken, 0, memory_order_release);
    atomic_store_explicit(&_finishRequested, false, memory_order_release);
    atomic_store_explicit(&_finishEpoch, 0, memory_order_release);
    atomic_store_explicit(&_finishAckEpoch, 0, memory_order_release);
    atomic_store_explicit(&_finishFenceWriteIndex, 0, memory_order_release);
    atomic_store_explicit(&_openPendingEpoch, 0, memory_order_release);
    atomic_store_explicit(&_openAckEpoch, 0, memory_order_release);
}

- (TVOAudioFormat *)captureFormat { return [self currentFormat]; }
- (TVOAudioFormat *)renderFormat { return [self currentFormat]; }
- (BOOL)initializeCapturer { return YES; }
- (BOOL)initializeRenderer { return YES; }

- (TVOAudioFormat *)currentFormat {
    if (!_format) {
        double sampleRate = AVAudioSession.sharedInstance.sampleRate;
        if (sampleRate <= 0) sampleRate = 48000.0;
        _format = [[TVOAudioFormat alloc] initWithChannels:TVOAudioChannelsMono
                                                sampleRate:sampleRate
                                           framesPerBuffer:kMaxFrames];
    }
    return _format;
}

- (BOOL)startCapturing:(TVOAudioDeviceContext)context {
    _capturingContext = context;
    TVOAudioSessionActivated(context);
    if (!self.isEnabled) return YES;
    return [self startUnit];
}
- (BOOL)startRendering:(TVOAudioDeviceContext)context {
    _renderingContext = context;
    TVOAudioSessionActivated(context);
    if (!self.isEnabled) return YES;
    return [self startUnit];
}
- (BOOL)stopCapturing {
    [self stopCopilotPlayback];
    TVOAudioDeviceContext stoppedContext = _capturingContext;
    _capturingContext = NULL;
    if (!_renderingContext) [self stopUnit];
    if (stoppedContext) TVOAudioSessionDeactivated(stoppedContext);
    return YES;
}
- (BOOL)stopRendering {
    [self stopCopilotPlayback];
    TVOAudioDeviceContext stoppedContext = _renderingContext;
    _renderingContext = NULL;
    if (!_capturingContext) [self stopUnit];
    if (stoppedContext) TVOAudioSessionDeactivated(stoppedContext);
    return YES;
}

- (uint64_t)closeOwnerUplinkAtFrameBoundary {
    atomic_store_explicit(&_openPendingEpoch, 0, memory_order_release);
    uint64_t token = CopilotHoldBegin(&_closeToken, &_finishRequested,
                                       &_finishEpoch, &_ownerUplinkClosed);
    // The callback stores this token only after it has written a silent frame.
    return token;
}
- (BOOL)isOwnerUplinkClosed {
    return atomic_load_explicit(&_ownerUplinkClosed, memory_order_acquire);
}
- (BOOL)waitForOwnerUplinkClosed:(uint64_t)token timeout:(NSTimeInterval)timeout {
    if (token == 0) return NO;
    return CopilotWaitUntil(timeout, ^BOOL {
        return atomic_load_explicit(&self->_ackToken, memory_order_acquire) >= token;
    });
}
- (BOOL)waitForPrivateDrain:(uint64_t)token timeout:(NSTimeInterval)timeout {
    if (token == 0) return NO;
    return CopilotWaitUntil(timeout, ^BOOL {
        if (atomic_load_explicit(&_finishAckEpoch, memory_order_acquire) >= token) {
            UInt32 fence = atomic_load_explicit(&_finishFenceWriteIndex, memory_order_acquire);
            UInt32 read = atomic_load_explicit(&_capturedRing.readIndex, memory_order_acquire);
            if ((int32_t)(read - fence) >= 0) return YES;
        }
        return NO;
    });
}
- (void)finishPrivateCaptureAtFrameBoundary:(uint64_t)epoch {
    if (epoch == 0) return;
    CopilotHoldFinish(&_finishEpoch, &_finishRequested, epoch);
}
- (BOOL)openOwnerUplink {
    if (atomic_load_explicit(&_interrupted, memory_order_acquire) ||
        atomic_load_explicit(&_forcedFailClosed, memory_order_acquire) ||
        !atomic_load_explicit(&_enabled, memory_order_acquire)) return NO;
    atomic_store_explicit(&_openPendingEpoch,
                          atomic_load_explicit(&_closeToken, memory_order_acquire),
                          memory_order_release);
    atomic_store_explicit(&_ownerUplinkClosed, false, memory_order_release);
    return YES;
}
- (BOOL)waitForOwnerUplinkOpen:(uint64_t)epoch timeout:(NSTimeInterval)timeout {
    if (epoch == 0) return NO;
    return CopilotWaitUntil(timeout, ^BOOL {
        return atomic_load_explicit(&self->_openAckEpoch, memory_order_acquire) >= epoch &&
               !atomic_load_explicit(&self->_ownerUplinkClosed, memory_order_acquire) &&
               !atomic_load_explicit(&self->_interrupted, memory_order_acquire) &&
               !atomic_load_explicit(&self->_forcedFailClosed, memory_order_acquire) &&
               atomic_load_explicit(&self->_enabled, memory_order_acquire);
    });
}
- (void)audioInterrupted {
    [self stopCopilotPlayback];
    atomic_store_explicit(&_interrupted, true, memory_order_release);
    atomic_store_explicit(&_ownerUplinkClosed, true, memory_order_release);
    atomic_store_explicit(&_openPendingEpoch, 0, memory_order_release);
}

- (void)scheduleDrain {
    bool expected = false;
    if (!atomic_compare_exchange_strong(&_drainScheduled, &expected, true)) return;
    dispatch_async(_drainQueue, ^{
        const void *bytes; UInt32 count, frames; uint64_t epoch;
        while (CopilotRingPop(&self->_capturedRing, &bytes, &count, &frames, &epoch)) {
            CopilotAudioPCMCallback callback = self.capturedPCM;
            if (callback) callback(bytes, count, frames, self.formatForCallback, epoch);
            if (epoch > atomic_load_explicit(&self->_privateDrainedToken, memory_order_relaxed)) {
                atomic_store_explicit(&self->_privateDrainedToken, epoch, memory_order_release);
            }
            CopilotRingRelease(&self->_capturedRing);
        }
        while (CopilotRingPop(&self->_remoteRing, &bytes, &count, &frames, &epoch)) {
            CopilotAudioPCMCallback callback = self.remotePCM;
            if (callback) callback(bytes, count, frames, self.formatForCallback, 0);
            CopilotRingRelease(&self->_remoteRing);
        }
        UInt32 playbackEvents = atomic_exchange_explicit(&self->_playbackEvents, 0,
                                                         memory_order_acq_rel);
        uint64_t playbackGeneration = atomic_load_explicit(&self->_playbackEventGeneration,
                                                           memory_order_acquire);
        if (playbackEvents && playbackGeneration ==
            atomic_load_explicit(&self->_playbackGeneration, memory_order_acquire)) {
            if ((playbackEvents & kPlaybackFirstEvent) &&
                !self->_playbackFirstCallbackDelivered && self->_playbackFirstAudio) {
                self->_playbackFirstCallbackDelivered = YES;
                self->_playbackFirstAudio();
            }
            if (playbackEvents & kPlaybackDoneEvent) {
                void (^completion)(BOOL) = self->_playbackCompletion;
                self->_playbackFirstAudio = nil;
                self->_playbackCompletion = nil;
                if (completion) completion(YES);
            }
        }
        atomic_store(&self->_drainScheduled, false);
        if (atomic_load(&self->_capturedRing.writeIndex) != atomic_load(&self->_capturedRing.readIndex) ||
            atomic_load(&self->_remoteRing.writeIndex) != atomic_load(&self->_remoteRing.readIndex) ||
            atomic_load_explicit(&self->_playbackEvents, memory_order_acquire) != 0) {
            [self scheduleDrain];
        }
    });
}
- (TVOAudioFormat *)formatForCallback { return _format ?: [self currentFormat]; }
- (void)performDrainQueueBlockAndWait:(dispatch_block_t)block {
    if (dispatch_get_specific(&kCopilotDrainQueueKey)) block();
    else dispatch_sync(_drainQueue, block);
}

// Writers are control-thread only. The mutation flag plus reader count forms a
// short lock-free callback barrier, so the fixed sample array is never changed
// while capture/render callbacks are reading it.
- (void)beginPlaybackMutation {
    atomic_store_explicit(&_playbackMutating, true, memory_order_seq_cst);
    while (atomic_load_explicit(&_playbackReaders, memory_order_seq_cst) != 0) usleep(1000);
}
- (void)endPlaybackMutation {
    atomic_store_explicit(&_playbackMutating, false, memory_order_seq_cst);
}
- (BOOL)startCopilotPlayback:(NSData *)pcm16 sampleRate:(double)sampleRate
                   firstAudio:(void (^)(void))firstAudio completion:(void (^)(BOOL))completion {
    // Concurrent start/stop callers are serialized here; realtime readers
    // never acquire this control-only lock.
    [_playbackControlLock lock];
    // Invalidate old events before replacing handler state, including on an
    // invalid start. A caller can therefore never receive stale callbacks.
    [self beginPlaybackMutation];
    atomic_store_explicit(&_playbackActive, false, memory_order_release);
    uint64_t generation = atomic_fetch_add_explicit(&_playbackGeneration, 1,
                                                    memory_order_acq_rel) + 1;
    atomic_store_explicit(&_playbackEvents, 0, memory_order_release);
    [self performDrainQueueBlockAndWait:^{
        self->_playbackFirstAudio = nil;
        self->_playbackCompletion = nil;
        self->_playbackFirstCallbackDelivered = NO;
    }];

    double targetRate = [self currentFormat].sampleRate;
    if (!_playbackSamples || !pcm16 || pcm16.length < sizeof(int16_t) ||
        (pcm16.length % sizeof(int16_t)) != 0 || !isfinite(sampleRate) ||
        sampleRate <= 0 || !isfinite(targetRate) || targetRate <= 0 ||
        !self.isEnabled || !_audioUnit || !_capturingContext) {
        [self endPlaybackMutation];
        [_playbackControlLock unlock];
        return NO;
    }
    UInt64 sourceCount = pcm16.length / sizeof(int16_t);
    long double targetCountValue = (long double)sourceCount * targetRate / sampleRate;
    if (targetCountValue < 1 || targetCountValue > kMaxPlaybackSamples) {
        [self endPlaybackMutation];
        [_playbackControlLock unlock];
        return NO;
    }
    UInt64 targetCount = (UInt64)targetCountValue;
    const int16_t *source = (const int16_t *)pcm16.bytes;
    // Linear interpolation is intentionally bounded/simple (not a studio
    // resampler) and happens here, never in an audio callback.
    for (UInt64 i = 0; i < targetCount; i++) {
        double sourcePosition = (double)i * sampleRate / targetRate;
        UInt64 left = (UInt64)sourcePosition;
        if (left >= sourceCount) left = sourceCount - 1;
        UInt64 right = left + 1 < sourceCount ? left + 1 : left;
        double fraction = sourcePosition - (double)left;
        double sample = source[left] + ((double)source[right] - source[left]) * fraction;
        if (sample > INT16_MAX) sample = INT16_MAX;
        if (sample < INT16_MIN) sample = INT16_MIN;
        _playbackSamples[i] = (int16_t)sample;
    }
    atomic_store_explicit(&_playbackCount, targetCount, memory_order_release);
    atomic_store_explicit(&_playbackCaptureCursor, 0, memory_order_release);
    atomic_store_explicit(&_playbackMonitorCursor, 0, memory_order_release);
    atomic_store_explicit(&_playbackEventGeneration, generation, memory_order_release);
    [self performDrainQueueBlockAndWait:^{
        self->_playbackFirstAudio = [firstAudio copy];
        self->_playbackCompletion = [completion copy];
        self->_playbackFirstCallbackDelivered = NO;
    }];
    atomic_store_explicit(&_playbackActive, true, memory_order_release);
    [self endPlaybackMutation];
    [_playbackControlLock unlock];
    return YES;
}

- (void)stopCopilotPlayback {
    [_playbackControlLock lock];
    [self beginPlaybackMutation];
    atomic_store_explicit(&_playbackActive, false, memory_order_release);
    uint64_t generation = atomic_fetch_add_explicit(&_playbackGeneration, 1,
                                                    memory_order_acq_rel) + 1;
    atomic_store_explicit(&_playbackEvents, 0, memory_order_release);
    __block void (^completion)(BOOL) = nil;
    [self performDrainQueueBlockAndWait:^{
        completion = self->_playbackCompletion;
        self->_playbackFirstAudio = nil;
        self->_playbackCompletion = nil;
        self->_playbackFirstCallbackDelivered = NO;
    }];
    atomic_store_explicit(&_playbackEventGeneration, generation, memory_order_release);
    [self endPlaybackMutation];
    [_playbackControlLock unlock];
    if (completion) {
        dispatch_async(_drainQueue, ^{
            if (atomic_load_explicit(&self->_playbackGeneration, memory_order_acquire) == generation) {
                completion(NO);
            }
        });
    }
}

- (BOOL)startUnit {
    if (!self.isEnabled) return NO;
    if (_audioUnit) return YES;
    // CallKit may invoke the SDK start callback before didActivate. The
    // official device keeps that lifecycle successful and reinitializes once
    // the session interruption/activation end notification arrives.
    if (AVAudioSession.sharedInstance.sampleRate <= 0) return YES;
    AudioComponentDescription desc = {
        .componentType = kAudioUnitType_Output, .componentSubType = kAudioUnitSubType_VoiceProcessingIO,
        .componentManufacturer = kAudioUnitManufacturer_Apple, .componentFlags = 0, .componentFlagsMask = 0
    };
    AudioComponent component = AudioComponentFindNext(NULL, &desc);
    if (!component || AudioComponentInstanceNew(component, &_audioUnit) != noErr) return NO;
    UInt32 yes = 1;
    if (AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output,
                             kBusOutput, &yes, sizeof(yes)) != noErr ||
        AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input,
                             kBusInput, &yes, sizeof(yes)) != noErr) {
        [self stopUnit]; return NO;
    }
    AudioStreamBasicDescription asbd = _format.streamDescription;
    AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output,
                         kBusInput, &asbd, sizeof(asbd));
    AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input,
                         kBusOutput, &asbd, sizeof(asbd));
    AURenderCallbackStruct render = { CopilotRenderCallback, (__bridge void *)self };
    AURenderCallbackStruct capture = { CopilotCaptureCallback, (__bridge void *)self };
    AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Output,
                         kBusOutput, &render, sizeof(render));
    AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Input,
                         kBusInput, &capture, sizeof(capture));
    if (AudioUnitInitialize(_audioUnit) != noErr || AudioOutputUnitStart(_audioUnit) != noErr) {
        [self stopUnit]; return NO;
    }
    return YES;
}
- (void)stopUnit {
    if (!_audioUnit) return;
    AudioOutputUnitStop(_audioUnit);
    AudioUnitUninitialize(_audioUnit);
    AudioComponentInstanceDispose(_audioUnit);
    _audioUnit = NULL;
}

- (void)interruption:(NSNotification *)note {
    AVAudioSessionInterruptionType type = [note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
    if (type == AVAudioSessionInterruptionTypeBegan) {
        [self audioInterrupted];
        if (_formatDidChange) _formatDidChange([self currentFormat]);
    } else {
        atomic_store(&_interrupted, false);
        atomic_store(&_forcedFailClosed, false);
        TVOAudioDeviceContext context = _capturingContext ?: _renderingContext;
        if (context) {
            TVOAudioDeviceExecuteWorkerBlock(context, ^{
                TVOAudioDeviceReinitialize(context);
            });
        }
    }
}
- (void)routeChange:(NSNotification *)note {
    (void)note;
    [self stopCopilotPlayback];
    atomic_store_explicit(&_forcedFailClosed, true, memory_order_release);
    _format = nil;
    TVOAudioDeviceContext context = _capturingContext ?: _renderingContext;
    if (context) {
        TVOAudioDeviceExecuteWorkerBlock(context, ^{
            TVOAudioDeviceReinitialize(context);
        });
    }
    if (_formatDidChange) _formatDidChange([self currentFormat]);
}
- (void)mediaReset:(NSNotification *)note {
    (void)note;
    [self stopCopilotPlayback];
    atomic_store_explicit(&_forcedFailClosed, true, memory_order_release);
    _format = nil;
    TVOAudioDeviceContext context = _capturingContext ?: _renderingContext;
    if (context) {
        TVOAudioDeviceExecuteWorkerBlock(context, ^{
            TVOAudioDeviceReinitialize(context);
        });
    }
    if (_formatDidChange) _formatDidChange([self currentFormat]);
}
@end

static OSStatus CopilotRenderCallback(void *refCon, AudioUnitRenderActionFlags *flags,
                                      const AudioTimeStamp *timestamp, UInt32 bus, UInt32 frames,
                                      AudioBufferList *bufferList) {
    (void)flags; (void)timestamp; (void)bus;
    CopilotAudioDevice *device = (__bridge CopilotAudioDevice *)refCon;
    UInt32 bytes = frames * kChannels * kBytesPerSample;
    if (device->_renderingContext && frames <= kMaxFrames && bufferList &&
        bufferList->mNumberBuffers > 0 && bufferList->mBuffers[0].mData &&
        bufferList->mBuffers[0].mDataByteSize >= bytes) {
        int16_t *samples = (int16_t *)bufferList->mBuffers[0].mData;
        TVOAudioDeviceReadRenderData(device->_renderingContext, samples, bytes);
        if (atomic_load_explicit(&device->_remoteTapEnabled, memory_order_acquire)) {
            // Tap before local Copilot monitoring so remotePCM remains guest-only.
            CopilotRingPush(&device->_remoteRing, samples, bytes, frames, 0);
            [device scheduleDrain];
        }
        atomic_fetch_add_explicit(&device->_playbackReaders, 1, memory_order_seq_cst);
        if (!atomic_load_explicit(&device->_playbackMutating, memory_order_seq_cst) &&
            atomic_load_explicit(&device->_playbackActive, memory_order_acquire)) {
            UInt64 cursor = atomic_load_explicit(&device->_playbackMonitorCursor,
                                                 memory_order_relaxed);
            UInt64 count = atomic_load_explicit(&device->_playbackCount, memory_order_acquire);
            UInt32 mixed = cursor < count ? (UInt32)MIN((UInt64)frames, count - cursor) : 0;
            for (UInt32 i = 0; i < mixed; i++) {
                int32_t sum = (int32_t)samples[i] + device->_playbackSamples[cursor + i];
                if (sum > INT16_MAX) sum = INT16_MAX;
                if (sum < INT16_MIN) sum = INT16_MIN;
                samples[i] = (int16_t)sum;
            }
            atomic_store_explicit(&device->_playbackMonitorCursor, cursor + mixed,
                                  memory_order_release);
        }
        atomic_fetch_sub_explicit(&device->_playbackReaders, 1, memory_order_seq_cst);
    } else {
        if (bufferList && bufferList->mNumberBuffers > 0 && bufferList->mBuffers[0].mData) {
            memset(bufferList->mBuffers[0].mData, 0, bufferList->mBuffers[0].mDataByteSize);
        }
    }
    return noErr;
}

static OSStatus CopilotCaptureCallback(void *refCon, AudioUnitRenderActionFlags *flags,
                                       const AudioTimeStamp *timestamp, UInt32 bus, UInt32 frames,
                                       AudioBufferList *bufferList) {
    (void)bus;
    CopilotAudioDevice *device = (__bridge CopilotAudioDevice *)refCon;
    if (!device->_capturingContext || frames > kMaxFrames) return noErr;
    // Hold one reader lease for the entire capture frame. Start/stop cannot
    // cross this boundary, so microphone taps and outbound replacement agree
    // on whether this frame belongs to a speech-playback interval.
    atomic_fetch_add_explicit(&device->_playbackReaders, 1, memory_order_seq_cst);
    bool playbackMutationAtStart =
        atomic_load_explicit(&device->_playbackMutating, memory_order_seq_cst);
    bool speechWasPlaying = !playbackMutationAtStart &&
        atomic_load_explicit(&device->_playbackActive, memory_order_acquire);
    device->_captureBuffer.mBuffers[0].mData = device->_captureBytes;
    device->_captureBuffer.mBuffers[0].mDataByteSize = frames * kChannels * kBytesPerSample;
    OSStatus status = AudioUnitRender(device->_audioUnit, flags, timestamp, kBusInput, frames,
                                      &device->_captureBuffer);
    UInt32 bytes = device->_captureBuffer.mBuffers[0].mDataByteSize;
    bool validCapture = status == noErr && device->_captureBytes && bytes > 0 &&
                        bytes <= kMaxFrames * kChannels * kBytesPerSample;
    if (!validCapture) {
        memset(device->_captureBytes, 0, frames * kChannels * kBytesPerSample);
        bytes = frames * kChannels * kBytesPerSample;
    }
    bool forcedClosed = atomic_load_explicit(&device->_forcedFailClosed, memory_order_acquire);
    bool interrupted = atomic_load_explicit(&device->_interrupted, memory_order_acquire);
    // One gate snapshot governs BOTH Twilio output and the private tap.
    // A second read after a close request could otherwise route the same
    // unsilenced frame privately while also handing it to the guest.
    bool uplinkClosed = atomic_load_explicit(&device->_ownerUplinkClosed, memory_order_acquire);
    bool closed = CopilotHoldSilencesUplink(
        uplinkClosed, forcedClosed, interrupted);
    uint64_t epoch = atomic_load_explicit(&device->_closeToken, memory_order_acquire);
    bool finishing = CopilotHoldIsFinishing(
        atomic_load_explicit(&device->_finishRequested, memory_order_acquire),
        atomic_load_explicit(&device->_finishEpoch, memory_order_acquire), epoch);
    // Public microphone PCM is transcribed in a separate Owner session. Its
    // ring epoch is zero; the Swift gate drops any queued public frames once
    // the private close has been acknowledged.
    if (!closed && validCapture && !speechWasPlaying &&
        atomic_load_explicit(&device->_enabled, memory_order_acquire) &&
        atomic_load_explicit(&device->_captureTapEnabled, memory_order_acquire)) {
        CopilotRingPush(&device->_capturedRing, device->_captureBytes, bytes, frames, 0);
    }
    // Private PCM is enqueued only after the uplink is closed.
    if (CopilotHoldRoutesPrivate(
        uplinkClosed,
        finishing, interrupted, forcedClosed,
        atomic_load_explicit(&device->_enabled, memory_order_acquire),
        atomic_load_explicit(&device->_captureTapEnabled, memory_order_acquire), epoch)) {
        CopilotRingPush(&device->_capturedRing, device->_captureBytes, bytes, frames, epoch);
    }
    if (closed) {
        memset(device->_captureBytes, 0, bytes);
        atomic_store_explicit(&device->_ackToken, epoch, memory_order_release);
    }
    // TTS is an outbound replacement, not microphone content: it never enters
    // either public or private PCM tap. A closed privacy gate always wins.
    bool sentSpeech = false;
    bool completedPlayback = false;
    if (speechWasPlaying && !closed) {
        UInt64 cursor = atomic_load_explicit(&device->_playbackCaptureCursor, memory_order_relaxed);
        UInt64 count = atomic_load_explicit(&device->_playbackCount, memory_order_acquire);
        UInt32 copied = cursor < count ? (UInt32)MIN((UInt64)frames, count - cursor) : 0;
        if (copied) {
            memcpy(device->_captureBytes, device->_playbackSamples + cursor,
                   copied * sizeof(int16_t));
            // The final speech callback can be shorter than a Twilio frame.
            // Never leave the Owner microphone in the tail of that frame.
            if (copied < frames) {
                memset(device->_captureBytes + copied * sizeof(int16_t), 0,
                       (frames - copied) * sizeof(int16_t));
            }
            sentSpeech = true;
            cursor += copied;
            atomic_store_explicit(&device->_playbackCaptureCursor, cursor, memory_order_release);
            if (cursor >= count) {
                atomic_store_explicit(&device->_playbackActive, false, memory_order_release);
                completedPlayback = true;
            }
        }
    }
    if (sentSpeech || completedPlayback) {
        uint32_t events = sentSpeech ? kPlaybackFirstEvent : 0;
        if (completedPlayback) events |= kPlaybackDoneEvent;
        atomic_store_explicit(&device->_playbackEventGeneration,
                              atomic_load_explicit(&device->_playbackGeneration, memory_order_acquire),
                              memory_order_release);
        atomic_fetch_or_explicit(&device->_playbackEvents, events, memory_order_acq_rel);
    }
    TVOAudioDeviceWriteCaptureData(device->_capturingContext, device->_captureBytes, bytes);
    if (CopilotHoldCanAcknowledgeOpen(
        closed, validCapture,
        atomic_load_explicit(&device->_enabled, memory_order_acquire),
        atomic_load_explicit(&device->_openPendingEpoch, memory_order_acquire), epoch)) {
        atomic_store_explicit(&device->_openAckEpoch, epoch, memory_order_release);
    }
    if (closed && finishing &&
        atomic_load_explicit(&device->_finishAckEpoch, memory_order_acquire) < epoch) {
        // The marker is published only after the silent frame was handed to
        // Twilio. It fences every private frame produced before this callback.
        UInt32 fence = atomic_load_explicit(&device->_capturedRing.writeIndex,
                                            memory_order_acquire);
        atomic_store_explicit(&device->_finishFenceWriteIndex, fence, memory_order_release);
        atomic_store_explicit(&device->_finishAckEpoch, epoch, memory_order_release);
    }
    atomic_fetch_sub_explicit(&device->_playbackReaders, 1, memory_order_seq_cst);
    if (sentSpeech || completedPlayback) [device scheduleDrain];
    if (atomic_load_explicit(&device->_captureTapEnabled, memory_order_relaxed) ||
        atomic_load_explicit(&device->_remoteTapEnabled, memory_order_relaxed)) [device scheduleDrain];
    return noErr;
}