import * as STREETLIFE from '../data/streetlife.js';

// How the street responds to Spider-Man and to itself: reactions to landings and low swings (look,
// point, cheer, film on a phone, cower, run), greetings as he walks past, vendors' and touts' calls,
// and the odd overheard remark. Bubbles carry the Shona text with a small English gloss.

const REACTIONS = STREETLIFE.REACTIONS?.length ? STREETLIFE.REACTIONS : [{ sn: 'Hezvo!', en: 'There it is!' }, { sn: 'Maiwe!', en: 'Oh my!' }];
const SCARY = /Ndatya|Zvinotyisa|Chenjera|Mhanya|Yowe|Mwari wangu|Maiwe|Mira!|Eish/;
const FEAR = REACTIONS.filter((r) => SCARY.test(r.sn));
const AWE = REACTIONS.filter((r) => !SCARY.test(r.sn));
const SAYINGS = STREETLIFE.NPC_SAYINGS?.length ? STREETLIFE.NPC_SAYINGS : [{ sn: 'Mhoro!', en: 'Hi!' }, { sn: 'Makadii?', en: 'How are you?' }];
const GREETING = /^(hi|hello|good |how |what's up)/i;
const GREETINGS = SAYINGS.filter((s) => GREETING.test(s.en));
const REMARKS = SAYINGS.filter((s) => !GREETING.test(s.en) && !/^(I'm fine|Yes|Yeah|No\.)/.test(s.en));
const HWINDI = STREETLIFE.HWINDI_CALLS?.length ? STREETLIFE.HWINDI_CALLS : [{ text: 'Town! Town!', en: 'To the city centre!' }];
const AIRBORNE = new Set(['air', 'swing', 'zip', 'dive', 'wall']);

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function daypart(hour) {
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export class Social {
  constructor(game, crowd, population, voices, bubbles) {
    this.game = game;
    this.crowd = crowd;
    this.pop = population;
    this.voices = voices;
    this.bubbles = bubbles;
    this.near = [];
    this.swingT = 0;
    this.greetAt = 0;
    this.remarkAt = 0;
    this.landAt = -10;
    this.lastBubble = 0;
    game.events.on('player:land', (e) => this.onLand(e));
  }

  // Everyone around a landing turns to look; a hard landing close by scatters people.
  onLand(e) {
    const game = this.game;
    const t = game.time;
    if (!e?.pos || t - this.landAt < 0.8) return;
    this.landAt = t;
    const hard = !!e.hard || (e.speed || 0) > 16;
    const px = e.pos.x;
    const pz = e.pos.z;
    const R = hard ? 30 : 24;
    const list = this.pop.list.filter((a) => {
      const d = Math.hypot(a.position.x - px, a.position.z - pz);
      a._d = d;
      return d < R && Math.abs(a.position.y - e.pos.y) < 8 && a.state !== 'flee';
    });
    list.sort((p, q) => p._d - q._d);
    let bubbles = 0;
    let barked = false;
    for (const a of list) {
      const d = a._d;
      if (!hard && t < (a.reactCool || 0)) continue;
      const notice = d < 9 ? 1 : 1 - (d - 9) / (R - 9);
      if (Math.random() > notice) continue;
      a.reactCool = t + 12;
      const delay = d / 45 + Math.random() * 0.35;
      let type;
      let scared = false;
      if (hard && d < 11) {
        scared = true;
        if (a.kind === 'walker' && Math.random() < 0.55) {
          this.crowd.startFlee(a, 2.5 + Math.random() * 2.5, px, pz);
          type = 'flee';
        } else {
          type = 'cover';
          this.crowd.startReaction(a, 'cover', 1.3 + Math.random() * 0.6, delay * 0.5);
          a.react.next = { type: Math.random() < 0.5 ? 'point' : 'photo', dur: 2.5 + Math.random() * 3 };
        }
      } else {
        type = this._excitedType(a);
        this.crowd.startReaction(a, type, 3 + Math.random() * 4, delay);
      }
      if (bubbles < 3 && (bubbles === 0 || Math.random() < 0.5)) {
        const line = pick(scared ? FEAR : AWE);
        this._say(a, line.sn, line.en, 2400, 'react', delay);
        bubbles++;
        if (!barked) barked = this.voices.bark(a, line);
      }
    }
  }

  _excitedType(a) {
    const r = Math.random();
    if (a.look.child) return r < 0.45 ? 'cheer' : r < 0.75 ? 'wave' : 'point';
    if (a.kind === 'vendor' && a.stall?.sit) return r < 0.5 ? 'point' : 'watch';
    return r < 0.3 ? 'photo' : r < 0.5 ? 'cheer' : r < 0.72 ? 'point' : 'watch';
  }

  _say(a, sn, en, ms, kind, delay = 0) {
    this.bubbles.show(a, sn, en, ms, kind, delay);
  }

  update(dt, ctx) {
    const game = this.game;
    const t = game.time;
    const state = game.player?.state;
    // Low swing overhead: heads turn, some point or film.
    if ((this.swingT -= dt) <= 0) {
      this.swingT = 0.4;
      if (AIRBORNE.has(state) && ctx.py < 30) {
        let said = false;
        for (const a of this.pop.list) {
          const dx = a.position.x - ctx.px;
          const dz = a.position.z - ctx.pz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 22 * 22 || a.state === 'react' || a.state === 'flee' || t < (a.reactCool || 0)) continue;
          if (Math.random() > 0.18 * (1 - Math.sqrt(d2) / 26)) continue;
          a.reactCool = t + 10;
          this.crowd.startReaction(a, this._excitedType(a), 2.2 + Math.random() * 2.5, Math.random() * 0.3);
          if (!said && t - this.lastBubble > 2.5) {
            const line = pick(AWE);
            this._say(a, line.sn, line.en, 2200, 'react');
            if (Math.random() < 0.4) this.voices.bark(a, line);
            this.lastBubble = t;
            said = true;
          }
        }
      }
    }
    if (!ctx.nearGround) return;
    // Greetings for Spider-Man walking by.
    if (ctx.playerOnFoot && t > this.greetAt) {
      const near = this.crowd.near(ctx.px, ctx.pz, 3.4, this.near);
      for (const a of near) {
        if (t < a.nextGreet || a.state === 'react' || a.state === 'flee') continue;
        const fx = -Math.sin(a.heading);
        const fz = -Math.cos(a.heading);
        if (fx * (ctx.px - a.position.x) + fz * (ctx.pz - a.position.z) < 0.2) continue;
        a.nextGreet = t + 40;
        if (Math.random() > 0.55) continue;
        const part = daypart(this.pop.hour ?? 12);
        const pool = GREETINGS.filter((g) => !g.timeOfDay || g.timeOfDay === part);
        const g = pick(pool.length ? pool : SAYINGS);
        this._say(a, g.sn, g.en, 2200, 'say');
        if (!a.stall?.sit) this.crowd.startReaction(a, 'wave', 1.6, 0);
        this.greetAt = t + 2.2;
        break;
      }
    }
    // Calls from vendors and touts, overheard remarks.
    if (this.bubbles.activeCount() >= 6) return;
    for (const a of this.pop.list) {
      if (t < a.nextBubble || a.state === 'react') continue;
      const d2 = (a.position.x - ctx.px) ** 2 + (a.position.z - ctx.pz) ** 2;
      if (a.kind === 'hwindi' && d2 < 35 * 35) {
        a.nextBubble = t + 4 + Math.random() * 6;
        const call = this._hwindiCall(a);
        this._say(a, call.text, call.en, 2300, 'call');
        a.timer = 2.5;
        return;
      }
      if (a.kind === 'vendor' && d2 < 24 * 24) {
        a.nextBubble = t + 9 + Math.random() * 14;
        const calls = a.stall?.def?.callouts;
        if (!calls?.length) continue;
        const c = pick(calls);
        this._say(a, c.sn, c.en, 2600, 'call');
        a.talkUntil = t + 1.2;
        return;
      }
    }
    if (t > this.remarkAt) {
      this.remarkAt = t + 5 + Math.random() * 7;
      const near = this.crowd.near(ctx.px, ctx.pz, 10, this.near).filter((a) => (a.state === 'chat' || a.state === 'walk') && !this.bubbles.hasBubble(a));
      if (near.length) {
        const a = pick(near);
        const r = pick(REMARKS);
        this._say(a, r.sn, r.en, 2600, 'say');
      }
    }
  }

  _hwindiCall(a) {
    const dests = a.rank?.info?.destinations || [];
    const own = HWINDI.filter((c) => dests.some((d) => c.text.includes(d.split(' ')[0])));
    return pick(own.length && Math.random() < 0.7 ? own : HWINDI);
  }
}
