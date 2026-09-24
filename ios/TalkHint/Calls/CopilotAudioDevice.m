//
//  CopilotAudioDevice.m
//
//  Portions of the audio-unit setup are derived from Twilio's
//  ExampleAVAudioEngineDevice.m, Copyright © 2018-2020 Twilio, Inc.,
//  released under the MIT License.  The original notice and reference are
//  retained here rather than copied into the application call manager.
//

#import "CopilotAudioDevice.h"
#import <AudioToolbox/AudioToolbox.h>
#import <unistd.h>

static const UInt32 kBusOutput = 0;
static const UInt32 kBusInput = 1;
static const UInt32 kMaxFrames = 3072;
static const UInt32 kChannels = 1;
static const UInt32 kBytesPerSample = 2;
static const UInt32 kRingSlots = 32;

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
    _Atomic(bool) _interrupted;
    _Atomic(bool) _forcedFailClosed;
    _Atomic(bool) _enabled;
    _Atomic(bool) _captureTapEnabled;
    _Atomic(bool) _remoteTapEnabled;
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

@implementation CopilotAudioDevice

- (instancetype)init {
    if ((self = [super init])) {
        _drainQueue = dispatch_queue_create("app.talkhint.copilot-audio-drain",
                                             DISPATCH_QUEUE_SERIAL);
        atomic_init(&_drainScheduled, false);
        atomic_init(&_ownerUplinkClosed, false);
        atomic_init(&_closeToken, 0);
        atomic_init(&_ackToken, 0);
        atomic_init(&_privateDrainedToken, 0);
        atomic_init(&_finishRequested, false);
        atomic_init(&_finishEpoch, 0);
        atomic_init(&_finishAckEpoch, 0);
        atomic_init(&_finishFenceWriteIndex, 0);
        atomic_init(&_interrupted, false);
        atomic_init(&_forcedFailClosed, false);
        atomic_init(&_enabled, true);
        atomic_init(&_captureTapEnabled, false);
        atomic_init(&_remoteTapEnabled, false);
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
    atomic_store_explicit(&_ownerUplinkClosed, false, memory_order_release);
    atomic_store_explicit(&_forcedFailClosed, false, memory_order_release);
    atomic_store_explicit(&_interrupted, false, memory_order_release);
    atomic_store_explicit(&_ackToken, 0, memory_order_release);
    atomic_store_explicit(&_privateDrainedToken, 0, memory_order_release);
    atomic_store_explicit(&_finishRequested, false, memory_order_release);
    atomic_store_explicit(&_finishEpoch, 0, memory_order_release);
    atomic_store_explicit(&_finishAckEpoch, 0, memory_order_release);
    atomic_store_explicit(&_finishFenceWriteIndex, 0, memory_order_release);
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
    TVOAudioDeviceContext stoppedContext = _capturingContext;
    _capturingContext = NULL;
    if (!_renderingContext) [self stopUnit];
    if (stoppedContext) TVOAudioSessionDeactivated(stoppedContext);
    return YES;
}
- (BOOL)stopRendering {
    TVOAudioDeviceContext stoppedContext = _renderingContext;
    _renderingContext = NULL;
    if (!_capturingContext) [self stopUnit];
    if (stoppedContext) TVOAudioSessionDeactivated(stoppedContext);
    return YES;
}

- (uint64_t)closeOwnerUplinkAtFrameBoundary {
    uint64_t token = atomic_fetch_add_explicit(&_closeToken, 1, memory_order_acq_rel) + 1;
    atomic_store_explicit(&_ownerUplinkClosed, true, memory_order_release);
    // The callback stores this token only after it has written a silent frame.
    return token;
}
- (BOOL)isOwnerUplinkClosed {
    return atomic_load_explicit(&_ownerUplinkClosed, memory_order_acquire);
}
- (BOOL)waitForOwnerUplinkClosed:(uint64_t)token timeout:(NSTimeInterval)timeout {
    if (token == 0) return NO;
    uint64_t deadline = (uint64_t)(timeout * 1000000.0);
    while (atomic_load_explicit(&_ackToken, memory_order_acquire) < token && deadline--) {
        usleep(1);
    }
    return atomic_load_explicit(&_ackToken, memory_order_acquire) >= token;
}
- (BOOL)waitForPrivateDrain:(uint64_t)token timeout:(NSTimeInterval)timeout {
    if (token == 0) return NO;
    uint64_t remaining = (uint64_t)(timeout * 1000000.0);
    while (remaining--) {
        if (atomic_load_explicit(&_finishAckEpoch, memory_order_acquire) >= token) {
            UInt32 fence = atomic_load_explicit(&_finishFenceWriteIndex, memory_order_acquire);
            UInt32 read = atomic_load_explicit(&_capturedRing.readIndex, memory_order_acquire);
            if ((int32_t)(read - fence) >= 0) return YES;
        }
        usleep(1);
    }
    return NO;
}
- (void)finishPrivateCaptureAtFrameBoundary:(uint64_t)epoch {
    if (epoch == 0) return;
    atomic_store_explicit(&_finishEpoch, epoch, memory_order_release);
    atomic_store_explicit(&_finishRequested, true, memory_order_release);
}
- (void)openOwnerUplink {
    atomic_store_explicit(&_ownerUplinkClosed, false, memory_order_release);
}
- (void)audioInterrupted {
    atomic_store_explicit(&_interrupted, true, memory_order_release);
    atomic_store_explicit(&_ownerUplinkClosed, true, memory_order_release);
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
        atomic_store(&self->_drainScheduled, false);
        if (atomic_load(&self->_capturedRing.writeIndex) != atomic_load(&self->_capturedRing.readIndex) ||
            atomic_load(&self->_remoteRing.writeIndex) != atomic_load(&self->_remoteRing.readIndex)) {
            [self scheduleDrain];
        }
    });
}
- (TVOAudioFormat *)formatForCallback { return _format ?: [self currentFormat]; }

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
    atomic_store_explicit(&_forcedFailClosed, true, memory_order_release);
    _format = nil;
    TVOAudioDeviceContext context = _capturingContext ?: _renderingContext;
    if (context) {
        TVOAudioDeviceExecuteWorkerBlock(context, ^{
            TVOAudioDeviceReinitialize(context);
        });
    }
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
        TVOAudioDeviceReadRenderData(device->_renderingContext, bufferList->mBuffers[0].mData, bytes);
        if (atomic_load_explicit(&device->_remoteTapEnabled, memory_order_acquire)) {
            CopilotRingPush(&device->_remoteRing, bufferList->mBuffers[0].mData, bytes, frames, 0);
            [device scheduleDrain];
        }
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
    device->_captureBuffer.mBuffers[0].mData = device->_captureBytes;
    device->_captureBuffer.mBuffers[0].mDataByteSize = frames * kChannels * kBytesPerSample;
    OSStatus status = AudioUnitRender(device->_audioUnit, flags, timestamp, kBusInput, frames,
                                      &device->_captureBuffer);
    UInt32 bytes = device->_captureBuffer.mBuffers[0].mDataByteSize;
    if (status != noErr || !device->_captureBytes || bytes == 0 ||
        bytes > kMaxFrames * kChannels * kBytesPerSample) {
        memset(device->_captureBytes, 0, frames * kChannels * kBytesPerSample);
        bytes = frames * kChannels * kBytesPerSample;
    }
    bool closed = atomic_load_explicit(&device->_ownerUplinkClosed, memory_order_acquire) ||
                  atomic_load_explicit(&device->_forcedFailClosed, memory_order_acquire) ||
                  atomic_load_explicit(&device->_interrupted, memory_order_acquire);
    bool interrupted = atomic_load_explicit(&device->_interrupted, memory_order_acquire);
    uint64_t epoch = atomic_load_explicit(&device->_closeToken, memory_order_acquire);
    bool finishing = atomic_load_explicit(&device->_finishRequested, memory_order_acquire) &&
        epoch >= atomic_load_explicit(&device->_finishEpoch, memory_order_acquire);
    // Private PCM is enqueued only after the gate was already observed closed.
    // Normal microphone frames never enter the Copilot ring.
    if (atomic_load_explicit(&device->_ownerUplinkClosed, memory_order_acquire) &&
        !finishing && !interrupted && epoch != 0 &&
        atomic_load_explicit(&device->_enabled, memory_order_acquire) &&
        atomic_load_explicit(&device->_captureTapEnabled, memory_order_acquire)) {
        CopilotRingPush(&device->_capturedRing, device->_captureBytes, bytes, frames, epoch);
    }
    if (closed) {
        memset(device->_captureBytes, 0, bytes);
        atomic_store_explicit(&device->_ackToken, epoch, memory_order_release);
    }
    TVOAudioDeviceWriteCaptureData(device->_capturingContext, device->_captureBytes, bytes);
    if (closed && finishing &&
        atomic_load_explicit(&device->_finishAckEpoch, memory_order_acquire) < epoch) {
        // The marker is published only after the silent frame was handed to
        // Twilio. It fences every private frame produced before this callback.
        UInt32 fence = atomic_load_explicit(&device->_capturedRing.writeIndex,
                                            memory_order_acquire);
        atomic_store_explicit(&device->_finishFenceWriteIndex, fence, memory_order_release);
        atomic_store_explicit(&device->_finishAckEpoch, epoch, memory_order_release);
    }
    if (atomic_load_explicit(&device->_captureTapEnabled, memory_order_relaxed) ||
        atomic_load_explicit(&device->_remoteTapEnabled, memory_order_relaxed)) [device scheduleDrain];
    return noErr;
}