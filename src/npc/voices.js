import * as THREE from 'three';
import { streetVoices } from './streetVoices.js';

// Voice director for the real Shona recordings (Google FLEURS, see public/audio/CREDITS.md).
// Clips come from the manifest in game.voices: 'line' = full sentence with Shona + English text,
// 'bark' = short fragment used for exclamations. Each speaking NPC is bound to one FLEURS speaker
// ('voice' id) of their own gender for as long as they live, and no two live NPCs share a speaker. A man
// who has said a recorded street phrase carries voice 'fsi' (social.js) and gets no FLEURS clips.
// At most two voices play at once (three counting the recorded street phrases of streetVoices.js); a
// clip is not heard again for a few minutes, or until the gender's pool is used up. Each person speaks
// at their own stable playback rate (agent.voiceRate, 0.94..1.06), so two people who share a FLEURS
// speaker still sound different.

const MAX_VOICES = 2;
const LINE_RANGE = 15; // m: ambient lines only play when people are this close
const MIN_GAP = 1.1; // s between two voice starts
// Most FLEURS speakers have a single clip, so a bound speaker may repeat it after this long (s);
// otherwise the few people near a player who stands still fall silent for good.
const REPEAT_AFTER = 150;
// Swinging away from someone mid-sentence: their subtitle goes once they are this far off (m).
const SUBTITLE_RANGE = 45;

export class VoiceDirector {
  constructor(game) {
    this.game = game;
    const clips = game.voices?.clips || [];
    this.pools = { line: { female: [], male: [] }, bark: { female: [], male: [] } };
    this.byVoice = new Map();
    for (const c of clips) {
      if (!this.pools[c.kind]?.[c.gender]) continue;
      this.pools[c.kind][c.gender].push(c);
      if (!this.byVoice.has(c.voice)) this.byVoice.set(c.voice, []);
      this.byVoice.get(c.voice).push(c);
    }
    this.owner = new Map(); // voice id -> agent
    this.played = new Map(); // clip id -> game time it last started
    this.active = []; // {agent, id, until, handle}
    this.lastStart = -1e9;
    this.nextLine = 4;
    this._head = new THREE.Vector3();
    this.street = streetVoices(game);
  }

  get available() {
    return this.byVoice.size > 0;
  }

  release(agent) {
    if (agent.voice && this.owner.get(agent.voice) === agent) this.owner.delete(agent.voice);
    agent.voice = null;
  }

  _fresh(c, t) {
    const at = this.played.get(c.id);
    return at === undefined || t - at > REPEAT_AFTER;
  }

  busy() {
    const t = this.game.time;
    this.active = this.active.filter((v) => v.until > t && v.agent.id === v.id);
    return this.active.length >= MAX_VOICES || t - this.lastStart < MIN_GAP || this.street.voiceCount() >= MAX_VOICES + 1;
  }

  // Choose a clip of `kind` for this agent, binding a speaker to them on first use.
  pickClip(agent, kind) {
    if (agent.look.child) return null;
    const t = this.game.time;
    if (agent.voice) {
      const own = (this.byVoice.get(agent.voice) || []).filter((c) => c.kind === kind);
      // Nothing fresh from this speaker: let someone else talk.
      return own.find((c) => this._fresh(c, t)) || null;
    }
    const pool = this.pools[kind]?.[agent.gender];
    if (!pool?.length) return null;
    const free = (c) => !this.owner.has(c.voice);
    let cands = pool.filter((c) => free(c) && this._fresh(c, t));
    if (!cands.length) {
      for (const c of pool) this.played.delete(c.id);
      cands = pool.filter(free);
    }
    if (!cands.length) return null;
    // Exclamations should be short.
    if (kind === 'bark') {
      const short = cands.filter((c) => c.dur <= 2.2);
      if (short.length) cands = short;
    }
    const clip = cands[Math.floor(Math.random() * cands.length)];
    agent.voice = clip.voice;
    this.owner.set(clip.voice, agent);
    return clip;
  }

  // Play a clip from the agent's head. `shown` overrides the text for barks (the reaction bubble).
  speak(agent, clip, shown) {
    const game = this.game;
    const t = game.time;
    this.played.set(clip.id, t);
    const head = this._head.set(agent.position.x, agent.position.y + 1.6 * agent.look.scale, agent.position.z);
    const rate = agent.voiceRate || 1;
    const handle = game.audio?.playVoice?.(clip.id, head.clone(), { volume: clip.kind === 'line' ? 1 : 0.9, rate });
    // Wall-clock length at this rate.
    const dur = handle?.duration ?? clip.dur / rate;
    agent.talkUntil = t + dur;
    agent.lastSpoke = t;
    this.lastStart = t;
    this.active.push({ agent, id: agent.id, until: t + dur, handle, clip, heard: true });
    if (handle) this.street.noteVoice(t + dur);
    const speaker = agent.role || agent.name || 'Passer-by';
    if (clip.kind === 'line') {
      game.hud?.showSubtitle?.({ speaker, sn: clip.sn, en: clip.en, ms: dur * 1000 + 1500 });
      game.events.emit('npc:speak', { npc: agent, clip, text: clip.en || clip.sn });
    } else {
      // The HUD subtitles npc:speak from clip.sn/en, so pass the exclamation the bubble shows.
      game.events.emit('npc:speak', { npc: agent, clip: { ...clip, sn: shown?.sn || '', en: shown?.en || '' }, text: shown?.sn || '' });
    }
    return dur;
  }

  bark(agent, shown) {
    if (!this.available || this.busy()) return false;
    const clip = this.pickClip(agent, 'bark');
    if (!clip) return false;
    this.speak(agent, clip, shown);
    return true;
  }

  // Ambient conversation: someone near a grounded player says a full line now and then.
  update(dt, ctx, candidates) {
    if (!this.available) return;
    const t = this.game.time;
    // Voices follow their speakers (people talk as they walk); a line whose speaker the player has
    // left behind loses its subtitle.
    const pp = this.game.player?.position;
    for (const v of this.active) {
      if (v.until < t) continue;
      const a = v.agent;
      const gone = v.agent.id !== v.id;
      if (v.heard && v.clip.kind === 'line' && pp && (gone || Math.hypot(a.position.x - pp.x, a.position.y - pp.y, a.position.z - pp.z) > SUBTITLE_RANGE)) {
        v.heard = false;
        this.game.hud?.dropSubtitle?.({ sn: v.clip.sn, en: v.clip.en });
      }
      if (gone || !v.handle?.setPosition) continue;
      v.handle.setPosition(this._head.set(a.position.x, a.position.y + 1.6 * a.look.scale, a.position.z));
    }
    if (t < this.nextLine || !ctx.nearGround || this.busy()) return;
    this.nextLine = t + 6 + Math.random() * 8;
    let total = 0;
    const pool = this._pool || (this._pool = []);
    pool.length = 0;
    for (const a of candidates) {
      if (a.look.child || a.talkUntil > t || t - a.lastSpoke < 40 || a.state === 'flee') continue;
      const d = Math.hypot(a.position.x - ctx.px, a.position.z - ctx.pz);
      if (d > LINE_RANGE) continue;
      const w = (a.state === 'chat' ? 3 : a.kind === 'vendor' || a.kind === 'rank' ? 2 : 1) * (1.4 - d / LINE_RANGE);
      pool.push(a, w);
      total += w;
    }
    for (let tries = 0; tries < 3 && total > 0; tries++) {
      let r = Math.random() * total;
      let pick = null;
      for (let i = 0; i < pool.length; i += 2) {
        r -= pool[i + 1];
        if (r <= 0) {
          pick = pool[i];
          break;
        }
      }
      if (!pick) break;
      const clip = this.pickClip(pick, 'line');
      if (!clip) continue;
      const dur = this.speak(pick, clip);
      // In a chatting group the speaker holds the floor for the whole line.
      if (pick.group) {
        pick.group.speaker = pick.group.members.indexOf(pick);
        pick.group.switchAt = t + dur;
      }
      return;
    }
  }
}
