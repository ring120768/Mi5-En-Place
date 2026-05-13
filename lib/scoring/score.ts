/**
 * Sprint 1 scoring engine.
 *
 * Per Intelligence Architecture v1.2:
 *   opportunity_score = base_signal_weight
 *                     × signal_stack_multiplier
 *                     × amplifier_multiplier
 *                     × decay_factor
 *                     − detractor_penalty
 *
 * Sprint 1 simplifications:
 *   - base_signal_weight = max weight across signals on the site
 *   - signal_stack_multiplier = 1.0 / 1.3 / 1.5 based on count
 *   - amplifier_multiplier = 1.0 (no amplifiers yet)
 *   - decay_factor = 1.0 (no decay yet)
 *   - detractor_penalty = 0 (no detractors yet)
 *
 * Future sprints layer the missing factors back in. Pure function — keep it
 * testable and deterministic.
 */

import type { DetectedSignal } from '@/lib/signals/classifier'

export function scoreOpportunity(signals: DetectedSignal[]): number {
  if (signals.length === 0) return 0

  const maxBase = Math.max(...signals.map((s) => s.weight))

  let stack = 1.0
  if (signals.length === 2) stack = 1.3
  else if (signals.length >= 3) stack = 1.5

  return Math.round(maxBase * stack * 100) / 100
}
