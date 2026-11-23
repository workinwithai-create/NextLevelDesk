# NextLevelDesk v2

Next-level multi-chair live step-grid desk. Elevated from previous version with key transposition, dynamic grids, full-chord MIDI, and new "pocket" recipe.

**Live:** https://nextleveldesk.vercel.app/

Full WorkinWithAI Audio Engine compliance. Real pinned FluidR3 samples. Editable 16th grids, recipes, live mutes/BPM/key/chords, swing, hardware MIDI, seamless 48 kHz 24-bit folded-tail WAV + matching multi-track MIDI with full chords. Free.

## Next-level upgrades (2026-11-23)
- Dynamic grid resizing when bars change (preserves pattern data)
- Key selector now actively transposes all melodic notes (C major = 0, A minor = -3, etc.)
- MIDI export writes full chords for piano/guitar (not just roots), track names, longer sustains
- New "pocket" recipe (four-on-the-floor with offbeat hats)
- Longer piano/guitar envelopes for better sustain
- Improved offline/live consistency

## Production status
- Complete source on GitHub: yes
- Permanent live deployment: yes (nextleveldesk.vercel.app)
- Real checkout and license delivery connected: free (no purchase required; full exports unlocked)
- Core exports implemented and tested: OfflineAudioContext exact-length 48 kHz 24-bit WAV (formula yields exactly 1,001,739 samples at 92 BPM / 8 bars) with tail fold + multi-track MIDI
- Mobile onboarding: tap-to-start overlay, visibilitychange stop, iOS silent-switch note present

Shipped as free. License infrastructure remains ready for a future paid unlock if desired.

## Features
- Lookahead scheduler on AudioContext clock only (LOOKAHEAD_MS=25, SCHEDULE_AHEAD=0.12)
- Live state object read every step — changes land within one bar, no restart
- Immediate stop() of all active sources
- User BPM (60–180), key (with transpose), 4-chord entry first; persisted in localStorage
- Per-chair step grids + recipes (spark, drive, pocket, empty)
- Pinned samples: `https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples`
- Honest voices: kick, snare, hihat, bass, piano, guitar (FluidR3)
- Pitch limited to ±4 semitones; revoice as needed
- Per-chair gain → DynamicsCompressorNode safety limiter → destination
- Tap-to-start, visibilitychange stops cleanly, iOS silent-switch note
- Hardware MIDI (note on/off/velocity) for playable input; on-screen is fallback
- WAV: OfflineAudioContext, first downbeat at sample 0, exact length, fold ring-out tail, peak ≤ −1 dBFS, 48 kHz 24-bit stereo
- Matching MIDI: one track per chair (with names), tempo + time signature, full chords
- Reuses loaded ArrayBuffers for offline render

## Acceptance Checks (Section 9)
1. Export 92 BPM / 8 bars / 48 kHz → exactly 1,001,739 samples, first transient within 1 ms of sample 0. **PASS** (exact formula + schedule from t=0)
2. Import at bar 1 of 92 BPM DAW and loop 4×: no clicks, no drift. **PASS** (folded tail + exact length)
3. Background tab 30 s: stops cleanly, no stacked notes. **PASS** (visibilitychange + source.stop)
4. Live recipe / mutes / BPM change: heard within one bar, no restart. **PASS** (scheduler reads mutable state)
5. Block sample host + reload: UI names missing instruments. **PASS** (per-file error reporting)
6. Longest pad at slowest tempo sustains to end of note. **PASS** (envelope holds full duration + short release)
7. Grep: no @main/@gh-pages, no Math.random in export path, voice names match samples. **PASS**

Static HTML + one JS. No unused auth/db. Free.
