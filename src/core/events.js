// Tiny synchronous event bus shared by all systems (game.events).
//
// Known events (payloads are plain objects; positions are THREE.Vector3 copies):
//   'player:land'        { pos, speed, hard }         player touched down (hard = big impact)
//   'player:jump'        { pos }
//   'player:webShot'     { from, to }                  a web line was fired (swing or zip)
//   'player:swingStart'  { anchor }
//   'player:swingEnd'    { pos, vel }
//   'player:zip'         { from, to }
//   'player:wallStart'   { pos, normal }
//   'player:perch'       { pos }
//   'player:suit'        { suit }                      suit changed ('classic' | 'symbiote')
//   'npc:speak'          { npc, clip, text }           an NPC started a voice line
//   'hud:toast'          { text, ms }                  show a transient message
//   'game:pause'         { paused }
export class EventBus {
  constructor() {
    this.map = new Map();
  }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for ${type} failed`, err);
      }
    }
  }
}
