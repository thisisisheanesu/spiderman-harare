import * as THREE from 'three';

let nextId = 1;

// One vehicle. The public part (contract, see docs/ARCHITECTURE.md) is position (body centre at road
// level), heading (rad, 0 = facing north/-z, CCW positive), speed (m/s), type, length, width, height.
// Everything else is simulation / rendering state owned by src/traffic.
export class Vehicle {
  constructor() {
    this.id = nextId++;
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.type = 'hatch';
    this.length = 4;
    this.width = 1.7;
    this.height = 1.5;
    this.parked = false;

    this.color = new THREE.Color();
    this.color2 = new THREE.Color();
    this.rows = 0;
    this.hwindi = false;
    this.hwindiShirt = new THREE.Color();
    this.hwindiTrousers = new THREE.Color();
    this.call = null;

    // Route: front bumper at arc length `s` on `path` (lane or connector); `next` is the connector at
    // the end of the lane it is on or about to enter; prev/prev2 are kept to place the rear axle.
    this.path = null;
    this.s = 0;
    this.acc = 0;
    this.next = null;
    this.prev = null;
    this.prev2 = null;

    // Junction reservation: request -> grant (approaching) -> box (inside, until the rear clears).
    this.reqJ = null;
    this.reqConn = null;
    this.reqKey = 0;
    this.reqReady = false;
    this.runRed = false;
    this.grantJ = null;
    this.grantConn = null;
    this.boxJ = null;
    this.boxConn = null;
    this.resLane = null;
    this.resLen = 0;
    this.resLane2 = null;
    this.resLen2 = 0;

    // Kerb stops (kombis, buses): planned stop on stopLane at stopS, then `dwell` seconds loading.
    this.stopLane = null;
    this.stopS = -1;
    this.stopDwell = 0;
    this.dwell = 0;
    this.atRank = false;
    this.leaveT = 0;

    this.lateral = 0;
    this.kerbShift = 0;
    this.lineWait = 0;
    this.stuck = 0;
    this.lcCooldown = 0;
    this.lcLeader = null;
    this.blink = 0;
    this.blinkT = 0;
    this.leader = null;
    this.gapKind = 0;
    this.hardGap = Infinity;
    this.obstacleGap = Infinity;
    this.npcGap = Infinity;
    this.blockedBy = 0;
    this.blockedT = 0;
    this.impatience = 0;

    this.odo = 0;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.latPrev = 0;
    this.honkCd = 0;
    this.honkIn = -1;
    this.callT = 0;
  }
}
