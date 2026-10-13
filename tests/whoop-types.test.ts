import { describe, it, expect } from 'vitest'
import { parseWhoopResponse, WhoopValidationError, type CollectionPath } from '../lib/whoop-types'

const time = { start: '2026-06-01T02:00:00.000Z', end: '2026-06-01T10:00:00Z', timezone_offset: '+05:00' }
const commonScore = { strain: 10, kilojoule: 2000, average_heart_rate: 120, max_heart_rate: 180 }
const valid: Record<CollectionPath, object> = {
  '/cycle': { id: 1, ...time, score_state: 'SCORED', score: commonScore },
  '/recovery': { cycle_id: 1, sleep_id: 'sleep-1', score_state: 'SCORED', score: { user_calibrating: false, recovery_score: 80, resting_heart_rate: 50, hrv_rmssd_milli: 100 } },
  '/activity/sleep': {
    id: 'sleep-1', cycle_id: 1, ...time, nap: false, score_state: 'SCORED',
    score: {
      stage_summary: { total_in_bed_time_milli: 10, total_awake_time_milli: 1, total_light_sleep_time_milli: 3, total_slow_wave_sleep_time_milli: 2, total_rem_sleep_time_milli: 4, disturbance_count: 1 },
      sleep_needed: { baseline_milli: 10, need_from_sleep_debt_milli: 1, need_from_recent_strain_milli: 1, need_from_recent_nap_milli: -1 },
    },
  },
  '/activity/workout': {
    id: 'workout-1', ...time, sport_name: 'Running', score_state: 'SCORED', score: {
      ...commonScore, zone_durations: { zone_zero_milli: 1, zone_one_milli: 2, zone_two_milli: 3, zone_three_milli: 4, zone_four_milli: 5, zone_five_milli: 6 },
    },
  },
}

describe('WHOOP boundary schema', () => {
  it.each(Object.keys(valid) as CollectionPath[])('accepts scored %s with optional metrics omitted', (path) => {
    const page = { records: [valid[path]], next_token: null }
    expect(parseWhoopResponse(path, page)).toEqual(page)
  })

  it.each(Object.keys(valid) as CollectionPath[])('rejects SCORED %s missing its score metrics', (path) => {
    expect(() => parseWhoopResponse(path, { records: [{ ...valid[path], score: {} }] })).toThrow(WhoopValidationError)
  })

  it.each(['2026-02-30T02:00:00Z', '2026-06-01T02:00:00', '2026-13-01T02:00:00Z'])('rejects ambiguous or invalid dates: %s', (start) => {
    expect(() => parseWhoopResponse('/cycle', { records: [{ ...valid['/cycle'], start }] })).toThrow(WhoopValidationError)
  })

  it('rejects wrong nested sleep metric types', () => {
    const row = { id: 'sleep-1', ...time, score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: '10' } } }
    expect(() => parseWhoopResponse('/activity/sleep', { records: [row] })).toThrow(WhoopValidationError)
  })

  it('rejects missing or nonnumeric body measurements', () => {
    expect(() => parseWhoopResponse('/user/measurement/body', { height_meter: 1.8 })).toThrow(WhoopValidationError)
    expect(() => parseWhoopResponse('/user/measurement/body', { height_meter: 1.8, weight_kilogram: '80', max_heart_rate: 190 })).toThrow(WhoopValidationError)
  })

  it('ignores additive upstream fields without accepting invalid consumed fields', () => {
    const profile = { user_id: 1, email: 'a@b.c', first_name: 'A', last_name: 'B', new_upstream_property: { nested: true } }
    expect(parseWhoopResponse('/user/profile/basic', profile)).toEqual(profile)
    expect(() => parseWhoopResponse('/user/profile/basic', { ...profile, user_id: '1' })).toThrow(WhoopValidationError)
  })
})
