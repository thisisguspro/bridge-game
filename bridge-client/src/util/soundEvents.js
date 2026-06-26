// Maps server event types -> a sound cue to play when the client sees one.
// Mirrors SOUND_EVENTS in the gameserver constants. Used by Play to fire SFX as
// gameplay events stream in. Cues with no audio file just no-op (see sound.js).
export const SOUND_EVENTS = {
  attack_warning: "attack_warning",
  attack_incoming: "attack_hit",
  attack_damage: "attack_hit",
  plane_downed: "plane_down",
  attack_ended: "attack_repelled",
  sabotage_started: "sabotage",
  airlock_distress: "airlock_distress",
  frozen_in_void: "freeze",
  eliminated_for_good: "ejected",
  player_downed: "downed",
  task_done: "task_done",
};
