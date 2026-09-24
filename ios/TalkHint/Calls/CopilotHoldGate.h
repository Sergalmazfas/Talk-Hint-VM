#ifndef COPILOT_HOLD_GATE_H
#define COPILOT_HOLD_GATE_H

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>

// Begin is only called after the previous hold's finish fence has drained.
// Clear its finish marker BEFORE publishing the next private epoch.
static inline uint64_t CopilotHoldBegin(_Atomic(uint64_t) *closeToken,
                                        _Atomic(bool) *finishRequested,
                                        _Atomic(uint64_t) *finishEpoch,
                                        _Atomic(bool) *uplinkClosed) {
    atomic_store_explicit(finishRequested, false, memory_order_release);
    atomic_store_explicit(finishEpoch, 0, memory_order_release);
    uint64_t epoch = atomic_fetch_add_explicit(closeToken, 1, memory_order_acq_rel) + 1;
    atomic_store_explicit(uplinkClosed, true, memory_order_release);
    return epoch;
}

static inline void CopilotHoldFinish(_Atomic(uint64_t) *finishEpoch,
                                     _Atomic(bool) *finishRequested,
                                     uint64_t epoch) {
    atomic_store_explicit(finishEpoch, epoch, memory_order_release);
    atomic_store_explicit(finishRequested, true, memory_order_release);
}

static inline bool CopilotHoldIsFinishing(bool requested, uint64_t finishEpoch,
                                         uint64_t currentEpoch) {
    return requested && currentEpoch != 0 && finishEpoch == currentEpoch;
}

static inline bool CopilotHoldSilencesUplink(bool uplinkClosed, bool forcedClosed,
                                             bool interrupted) {
    return uplinkClosed || forcedClosed || interrupted;
}

static inline bool CopilotHoldRoutesPrivate(bool uplinkClosed, bool finishing,
                                            bool interrupted, bool forcedClosed, bool enabled,
                                            bool tapEnabled, uint64_t epoch) {
    return uplinkClosed && !finishing && !interrupted && !forcedClosed &&
           enabled && tapEnabled && epoch != 0;
}

static inline bool CopilotHoldCanAcknowledgeOpen(bool closed, bool validCapture,
                                                 bool enabled, uint64_t pendingEpoch,
                                                 uint64_t currentEpoch) {
    return !closed && validCapture && enabled && pendingEpoch != 0 &&
           pendingEpoch == currentEpoch;
}

#endif