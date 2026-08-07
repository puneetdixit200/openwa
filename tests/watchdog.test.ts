import { describe, expect, it } from 'vitest';
import { decideWatchdog, emptyWatchdogMemory, type WatchdogMemory } from '../src/watchdog.js';

function step(memory: WatchdogMemory, probe: Parameters<typeof decideWatchdog>[0]) {
  return decideWatchdog(probe, memory);
}

describe('collector watchdog decisions', () => {
  it('notifies on the first unreachable check and restarts after three consecutive failures', () => {
    let memory = emptyWatchdogMemory();
    let decision = step(memory, { healthReachable: false });
    expect(decision.events).toContain('unreachable');
    expect(decision.restart).toBe(false);
    memory = decision.memory;

    decision = step(memory, { healthReachable: false });
    expect(decision.restart).toBe(false);
    memory = decision.memory;

    decision = step(memory, { healthReachable: false });
    expect(decision.events).toContain('watchdog-restart');
    expect(decision.restart).toBe(true);
    expect(decision.memory.automaticRestarts).toBe(1);
  });

  it('never restarts an authentication-required or ordinary offline state', () => {
    const auth = step(emptyWatchdogMemory(), {
      healthReachable: true,
      connectionState: 'auth_required',
      listenerActive: false,
    });
    expect(auth.events).toContain('auth-required');
    expect(auth.restart).toBe(false);

    const offline = step(auth.memory, {
      healthReachable: true,
      connectionState: 'offline',
      listenerActive: false,
    });
    expect(offline.events).toContain('offline');
    expect(offline.restart).toBe(false);
  });

  it('notifies on recovery and resets the automatic restart budget', () => {
    const previous: WatchdogMemory = {
      healthFailures: 0,
      notReadyChecks: 0,
      automaticRestarts: 2,
      lastState: 'offline',
    };
    const decision = step(previous, {
      healthReachable: true,
      connectionState: 'connected',
      listenerActive: true,
    });
    expect(decision.events).toContain('recovered');
    expect(decision.memory.automaticRestarts).toBe(0);
    expect(decision.memory.lastState).toBe('ready');
  });

  it('alerts when a transitional state remains not ready for three checks', () => {
    let memory = emptyWatchdogMemory();
    for (let index = 0; index < 2; index++) {
      const decision = step(memory, {
        healthReachable: true,
        connectionState: 'connecting',
        listenerActive: false,
      });
      expect(decision.events).not.toContain('not-ready');
      memory = decision.memory;
    }
    const third = step(memory, {
      healthReachable: true,
      connectionState: 'connecting',
      listenerActive: false,
    });
    expect(third.events).toContain('not-ready');
  });

  it('caps automatic watchdog restarts and then asks for human attention', () => {
    let memory: WatchdogMemory = {
      healthFailures: 2,
      notReadyChecks: 0,
      automaticRestarts: 3,
      lastState: 'unreachable',
    };
    const decision = step(memory, { healthReachable: false });
    expect(decision.restart).toBe(false);
    expect(decision.events).toContain('watchdog-gave-up');
    expect(decision.memory.lastState).toBe('gave-up');
  });
});
