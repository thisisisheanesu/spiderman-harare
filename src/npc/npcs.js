// Placeholder pedestrian system — replaced by the full crowd + voices implementation.
// Public API (game.npcs): list (array of {position: Vector3, heading, gender}), npcsNear(x, z, r)
export class Npcs {
  constructor() {
    this.list = [];
  }

  async init(game) {
    this.game = game;
  }

  npcsNear() {
    return [];
  }

  update() {}
}
