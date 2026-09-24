#include "../TalkHint/Calls/CopilotHoldGate.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
    _Atomic(uint64_t) epoch = 0, finishEpoch = 0;
    _Atomic(bool) closed = false, finishRequested = false;
    for (uint64_t attempt = 1; attempt <= 10; attempt++) {
        // A callback already in flight before close uses its original gate
        // snapshot for both Twilio output and private routing. It cannot
        // reclassify that same frame as private after the close request.
        bool inFlightUplinkClosed = atomic_load(&closed);
        uint64_t token = CopilotHoldBegin(&epoch, &finishRequested, &finishEpoch, &closed);
        assert(token == attempt);
        assert(!CopilotHoldRoutesPrivate(inFlightUplinkClosed, false, false,
                                         false, true, true, token));
        assert(CopilotHoldSilencesUplink(atomic_load(&closed), false, false));
        assert(!CopilotHoldIsFinishing(atomic_load(&finishRequested),
                                      atomic_load(&finishEpoch), token));
        assert(CopilotHoldRoutesPrivate(true, false, false, false, true, true, token));
        assert(!CopilotHoldRoutesPrivate(false, false, false, false, true, true, token));
        assert(!CopilotHoldRoutesPrivate(true, false, true, false, true, true, token));
        assert(!CopilotHoldRoutesPrivate(true, false, false, true, true, true, token));
        assert(!CopilotHoldRoutesPrivate(true, false, false, false, false, true, token));
        // Releasing immediately, even with no audio, fences this same epoch.
        CopilotHoldFinish(&finishEpoch, &finishRequested, token);
        assert(CopilotHoldIsFinishing(atomic_load(&finishRequested),
                                     atomic_load(&finishEpoch), token));
        assert(!CopilotHoldRoutesPrivate(true, true, false, false, true, true, token));
        // A failed drain never clears the finish marker or opens the uplink.
        assert(atomic_load(&closed));
        // Simulate an acknowledged finish fence and an open callback before
        // allowing another hold. No private frame is routed to public output.
        atomic_store(&closed, false);
        assert(!CopilotHoldCanAcknowledgeOpen(false, false, true, token, token));
        assert(!CopilotHoldCanAcknowledgeOpen(false, true, true, 0, token));
        assert(!CopilotHoldCanAcknowledgeOpen(false, true, true, token - 1, token));
        assert(!CopilotHoldCanAcknowledgeOpen(true, true, true, token, token));
        assert(CopilotHoldCanAcknowledgeOpen(false, true, true, token, token));
        assert(!CopilotHoldSilencesUplink(atomic_load(&closed), false, false));
        assert(CopilotHoldSilencesUplink(false, true, false));
        assert(CopilotHoldSilencesUplink(false, false, true));
    }
    puts("Copilot hold gate: 10 private/public cycles passed");
    return 0;
}