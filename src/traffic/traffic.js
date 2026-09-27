// Placeholder traffic system — replaced by the full cars + kombis simulation.
// Public API (game.traffic): vehicles (array of {position: Vector3, heading, speed, type, length, width}),
// vehiclesNear(x, z, r)
export class Traffic {
  constructor() {
    this.vehicles = [];
  }

  async init(game) {
    this.game = game;
  }

  vehiclesNear() {
    return [];
  }

  update() {}
}
