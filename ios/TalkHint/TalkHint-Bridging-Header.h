//
//  TalkHint-Bridging-Header.h
//
//  Exposes the Copilot audio-device seam to the Swift call pipeline.  The
//  device itself is Objective-C because TVOAudioDevice's realtime callbacks
//  are C/Objective-C APIs.
//

#import "Calls/CopilotAudioDevice.h"