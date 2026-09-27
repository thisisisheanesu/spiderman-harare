# Procedural Spider-Man suit painter. Everything is computed per texel from the 3D rest-pose
# position (A-pose, metres, character faces +Y in Blender, right side at +X, z up), interpolated
# through the MakeHuman UV layout, so web lines are continuous across UV seams.
#
#  - torso web: spherical coordinates around a centre inside the chest with the pole pointing
#    forward -> radials fan out from the chest emblem, wrap over the shoulders and converge again
#    in the middle of the back; the "rings" sag towards the centre between radials (scalloped).
#  - head web: same idea, pole between the eyes.
#  - arms / boots: cylindrical coordinates along the bone chain: rings around the limb plus
#    lengthwise lines; a ring always falls on the elbow / wrist / part seams.
#  - red / blue regions are signed-distance fields in metres so borders are anti-aliased and get
#    a black outline like the real suit.
import numpy as np

LINE_W = 0.0034        # black web line width (m)
BUMP_W = 0.0052        # raised web cord width (m)
OUTLINE_W = 0.0036


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def line_cov(d, w, px):
    """coverage (0..1) of a line of width w at distance d, antialiased over one texel px."""
    return 1.0 - sstep(w * 0.5 - px * 0.5, w * 0.5 + px * 0.5, d)


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def seg_param(p, a, b):
    ab = b - a
    L = np.linalg.norm(ab)
    t = ((p - a) @ ab) / (L * L)
    return t, L


def cyl_coords(p, joints, ref):
    """p (N,3). joints: list of joint positions along a limb. Returns s (m from first joint, continuous),
    theta (rad around the local axis, 0 = `ref` direction), r (m from axis), seg index, seg starts."""
    N = len(p)
    best = np.full(N, 1e9); s = np.zeros(N); th = np.zeros(N); rr = np.zeros(N); seg = np.zeros(N, int)
    acc = 0.0
    starts = []
    for i in range(len(joints) - 1):
        a, b = joints[i], joints[i + 1]
        t, L = seg_param(p, a, b)
        tc = np.clip(t, 0 if i > 0 else -0.5, 1 if i < len(joints) - 2 else 1.6)
        q = p - (a + np.outer(tc, b - a))
        d = np.linalg.norm(q, axis=1)
        ax = (b - a) / L
        e1 = ref - (ref @ ax) * ax; e1 /= np.linalg.norm(e1)
        e2 = np.cross(ax, e1)
        qq = p - (a + np.outer(t, b - a))
        m = d < best
        best[m] = d[m]
        s[m] = acc + t[m] * L
        th[m] = np.arctan2(qq[m] @ e2, qq[m] @ e1)
        rr[m] = np.linalg.norm(qq[m], axis=1)
        seg[m] = i
        starts.append(acc)
        acc += L
    starts.append(acc)
    return s, th, rr, seg, np.array(starts)


def ring_dist(s, seg, starts, spacing):
    """distance (m) to the nearest ring, rings evenly spaced within each segment so that one
    always falls on each joint."""
    d = np.full(len(s), 1e9)
    for i in range(len(starts) - 1):
        L = starts[i + 1] - starts[i]
        n = max(1, int(round(L / spacing)))
        sp = L / n
        m = seg == i
        loc = s[m] - starts[i]
        d[m] = np.abs(loc - np.round(loc / sp) * sp)
    return d


def sphere_web(p, centre, n_rad, dphi, sag=0.28, pole=np.array([0, 1.0, 0]), up=np.array([0, 0, 1.0])):
    v = p - centre
    r = np.linalg.norm(v, axis=1) + 1e-9
    cosphi = np.clip((v @ pole) / r, -1, 1)
    phi = np.arccos(cosphi)
    e2 = np.cross(pole, up)
    lam = np.arctan2(v @ e2, v @ up)          # 0 = up, +pi/2 = towards e2
    dl = 2 * np.pi / n_rad
    k = lam / dl
    f = k - np.floor(k)
    d_rad = r * np.sin(phi) * np.abs(f - np.round(f)) * dl
    sagv = 4 * f * (1 - f)
    phe = phi + sag * sagv * dphi
    d_ring = r * np.abs(phe - np.round(phe / dphi) * dphi)
    # rings only start a bit away from the pole (emblem / face centre)
    d_ring = np.where(phi < dphi * 0.6, 1e9, d_ring)
    return np.minimum(d_rad, d_ring), phi, lam, r


def capsule_sdf(P, a, b, r):
    a = np.asarray(a, float); b = np.asarray(b, float)
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + np.outer(t, ab)), axis=1) - r


def ellipse_sdf(P, c, rx, ry):
    q = (P - np.asarray(c)) / np.array([rx, ry])
    return (np.linalg.norm(q, axis=1) - 1) * min(rx, ry)


def spider_sdf(P, scale=1.0, leg_w=0.0045, body_scale=1.0, style='classic'):
    """2D spider silhouette SDF (metres). P (N,2) with y up, centred on the spider's body."""
    s = scale
    d = ellipse_sdf(P, (0, 0.020 * s), 0.0105 * s * body_scale, 0.016 * s * body_scale)      # head/thorax
    d = np.minimum(d, ellipse_sdf(P, (0, -0.021 * s), 0.0135 * s * body_scale, 0.026 * s * body_scale))  # abdomen
    d = np.minimum(d, ellipse_sdf(P, (0, 0.040 * s), 0.0065 * s * body_scale, 0.008 * s * body_scale))   # head
    w = leg_w * s
    for sx in (-1, 1):
        # four legs per side: (hip, knee, foot) — upper two point up, lower two point down
        legs = [((0.008, 0.030), (0.030, 0.062), (0.040, 0.105)),
                ((0.010, 0.020), (0.045, 0.040), (0.062, 0.070)),
                ((0.010, 0.008), (0.045, -0.010), (0.062, -0.052)),
                ((0.008, -0.002), (0.030, -0.040), (0.040, -0.098))]
        for (h, k, f) in legs:
            H = np.array([h[0] * sx, h[1]]) * s; K = np.array([k[0] * sx, k[1]]) * s; F = np.array([f[0] * sx, f[1]]) * s
            d = np.minimum(d, capsule_sdf(P, H, K, w))
            d = np.minimum(d, capsule_sdf(P, K, F, w * 0.8))
    return d


def lens_sdf(yaw, pitch, side, big=False):
    """Mask lens in head-angle space (radians) -> metres-ish (assumes ~0.1 m head radius).
    Teardrop: pointed low inner corner by the nose, rounded high outer end."""
    R = 0.1
    x = yaw * side * R      # + = outwards from the nose
    y = pitch * R
    cx, cy = (0.037, 0.0) if not big else (0.039, 0.001)
    ang = np.radians(24)
    dx, dy = x - cx, y - cy
    u = dx * np.cos(ang) + dy * np.sin(ang)       # along the lens (outer = +)
    v = -dx * np.sin(ang) + dy * np.cos(ang)
    a = 0.032 if not big else 0.036
    b = 0.0205 if not big else 0.024
    t = np.clip(u / a, -1, 1)
    bb = b * (0.42 + 0.58 * np.sqrt(np.clip((t + 1) / 2, 0, 1)))
    q = np.sqrt((u / a) ** 2 + (v / bb) ** 2)
    return (q - 1) * np.minimum(bb, a)


def paint(P, Nrm, W, J, texel, parts):
    """P (N,3) positions, Nrm normals, W dict part->(N,) weights, J dict of joint positions,
    texel (N,) metres per texel. Returns dict of per-texel arrays."""
    N = len(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    part = parts  # (N,) int labels: 0 head,1 torso,2 uarm,3 farm,4 hand,5 thigh,6 calf,7 foot
    px = texel

    red = np.zeros(N)      # signed field (m), >0 red
    web = np.full(N, 1e9)  # distance to web line (m)
    extra_black = np.zeros(N)  # coverage of emblem etc.

    # ---------------- torso -----------------
    zc = J['spine_03'][2] + 0.52 * (J['neck_01'][2] - J['spine_03'][2])
    Ct = np.array([0.0, J['spine_03'][1] - 0.01, zc])
    d_t, phi_t, lam_t, r_t = sphere_web(P, Ct, 18, np.radians(12.5))
    z_arm = J['upperarm_r'][2] - 0.115
    z_belt = J['pelvis'][2] + 0.035
    theta = np.arctan2(x, y)  # 0 front, +-pi back
    rxy = np.sqrt(x * x + y * y)
    tt = np.clip((z_arm - z) / max(z_arm - z_belt, 1e-3), 0, 1)
    th_front = 1.02 - 0.62 * tt ** 0.8
    sd_front = (th_front - np.abs(theta)) * rxy
    tb = np.clip((z_arm - z) / 0.21, 0, 1)
    th_back = 1.15 * (1 - tb) ** 1.3
    sd_back = (th_back - np.abs(wrap(theta - np.pi))) * rxy
    sd_top = z - z_arm
    sd_belt = 0.021 - np.abs(z - z_belt)
    torso_red = np.maximum.reduce([sd_front, sd_back, sd_top, sd_belt])
    # classic back spider (red on the blue lower back)
    back = np.stack([-x, z - (z_arm - 0.075)], 1)   # seen from behind (symmetric anyway)
    sp_back = spider_sdf(back, scale=2.3, leg_w=0.0045, body_scale=1.05)
    back_face = (np.abs(wrap(theta - np.pi)) < 1.2)
    torso_red = np.where(back_face, np.maximum(torso_red, -sp_back), torso_red)
    tmask = part == 1
    red[tmask] = torso_red[tmask]
    web[tmask] = d_t[tmask]
    # no web inside the back spider body
    web[tmask & back_face & (sp_back < 0) & (z < z_arm)] = 1e9
    # chest emblem (black)
    chest = np.stack([x, z - (zc - 0.004)], 1)
    emb = spider_sdf(chest, scale=1.0, leg_w=0.0036)
    emb_cov = line_cov(np.maximum(emb, 0), 0.0, px) * (y > 0)
    emb_cov = np.where(emb < 0, 1.0, emb_cov) * (y > 0) * tmask

    # ---------------- head / neck -----------------
    eye_z = 0.5 * (J['eye_l'][2] + J['eye_r'][2])
    Ch = np.array([0.0, J['head'][1] + 0.012, eye_z - 0.006])
    d_h, phi_h, lam_h, r_h = sphere_web(P, Ch, 16, np.radians(13.5), sag=0.3)
    hmask = part == 0
    red[hmask] = 1.0
    web[hmask] = d_h[hmask]
    yaw = np.arctan2(x - Ch[0], y - Ch[1])
    pitch = np.arctan2(z - Ch[2] - 0.006, np.sqrt((x - Ch[0]) ** 2 + (y - Ch[1]) ** 2))
    lensL = lens_sdf(yaw, pitch, -1); lensR = lens_sdf(yaw, pitch, 1)
    lens = np.minimum(lensL, lensR)
    lensB = np.minimum(lens_sdf(yaw, pitch, -1, big=True), lens_sdf(yaw, pitch, 1, big=True))
    front_face = (y - Ch[1]) > 0
    lens = np.where(front_face & hmask, lens, 1.0)
    lensB = np.where(front_face & hmask, lensB, 1.0)

    # ---------------- arms -----------------
    for side, sfx in ((1, 'r'), (-1, 'l')):
        joints = [J['upperarm_' + sfx], J['lowerarm_' + sfx], J['hand_' + sfx], J['middle_tip_' + sfx]]
        s, th, rr, seg, starts = cyl_coords(P, joints, np.array([0, 1.0, 0]))
        amask = ((part == 2) | (part == 3) | (part == 4)) & (np.sign(x) == side)
        # underside direction: from the arm axis towards the body/down (theta measured from front)
        ax = joints[1] - joints[0]; ax /= np.linalg.norm(ax)
        down = np.array([-side * 0.9, 0, -1.0]); down -= (down @ ax) * ax; down /= np.linalg.norm(down)
        fr = np.array([0, 1.0, 0]); fr -= (fr @ ax) * ax; fr /= np.linalg.norm(fr)
        th_down = np.arctan2(down @ np.cross(ax, fr), down @ fr)
        dth = np.abs(wrap(th - th_down))
        Lu = starts[1]; Lf = starts[2] - starts[1]
        half = np.where(seg == 0, np.radians(68), np.radians(68) - np.radians(30) * np.clip((s - Lu) / Lf, 0, 1))
        sd = (dth - half) * np.maximum(rr, 0.02)
        sd = np.where(seg >= 2, 1.0, sd)  # gloves red
        dring = ring_dist(s, seg, starts, 0.036)
        dlong = rr * np.abs(wrap(th - np.round(th / (np.pi / 4)) * (np.pi / 4)))
        dlong = np.where(seg >= 2, rr * np.abs(wrap(th - np.round(th / (np.pi / 3)) * (np.pi / 3))), dlong)
        dweb = np.minimum(dring, dlong)
        red[amask] = sd[amask]
        web[amask] = dweb[amask]
        # ---------------- legs -----------------
        lj = [J['thigh_' + sfx], J['calf_' + sfx], J['foot_' + sfx], J['toe_' + sfx]]
        s, th, rr, seg, starts = cyl_coords(P, lj, np.array([0, 1.0, 0]))
        lmask = ((part == 5) | (part == 6) | (part == 7)) & (np.sign(x) == side)
        Lt = starts[1]
        front_amt = np.cos(th)  # 1 = front of shin
        boot_top = Lt + 0.12 - 0.05 * front_amt
        sd = s - boot_top
        dring = ring_dist(s - 0.0, seg, starts, 0.036)
        dlong = rr * np.abs(wrap(th - np.round(th / (np.pi / 4)) * (np.pi / 4)))
        red[lmask] = sd[lmask]
        web[lmask] = np.minimum(dring, dlong)[lmask]

    red_cov = sstep(-px * 0.5, px * 0.5, red)
    outline = line_cov(np.abs(red), OUTLINE_W, px)
    web_cov = line_cov(web, LINE_W, px) * sstep(-0.001, 0.001, red)
    web_h = np.clip(1 - web / (BUMP_W * 0.5), 0, 1) ** 0.7 * sstep(-0.001, 0.001, red)
    out_h = np.clip(1 - np.abs(red) / (BUMP_W * 0.5), 0, 1) ** 0.7

    # ---------------- classic colours -----------------
    RED = np.array([0.62, 0.035, 0.05]); RED_D = np.array([0.45, 0.02, 0.035])
    BLUE = np.array([0.045, 0.10, 0.36]); BLACK = np.array([0.018, 0.018, 0.022])
    WHITE = np.array([0.86, 0.88, 0.9])
    # subtle fabric shading variation (fold-ish low-frequency noise from normals)
    shade = 0.93 + 0.07 * np.clip(Nrm[:, 2] * 0.5 + 0.5, 0, 1)
    base = (np.outer(red_cov, RED) + np.outer(1 - red_cov, BLUE)) * shade[:, None]
    blk = np.clip(np.maximum.reduce([web_cov, outline, emb_cov]), 0, 1)
    base = base * (1 - blk[:, None]) + np.outer(blk, BLACK)
    # lenses: thick black frame + white lens
    frame = 1 - sstep(0.0075 - px * 0.5, 0.0075 + px * 0.5, lens)
    lens_in = 1 - sstep(-px * 0.5, px * 0.5, lens)
    base = base * (1 - frame[:, None]) + np.outer(frame, BLACK)
    base = base * (1 - lens_in[:, None]) + np.outer(lens_in, WHITE)
    rough_c = 0.62 - 0.22 * blk
    rough_c = rough_c * (1 - lens_in) + 0.12 * lens_in
    height = np.maximum(web_h, out_h * 0.8) * 1.0 + (1 - sstep(0.0, 0.012, lens)) * 0.8 * (1 - lens_in)

    # ---------------- symbiote -----------------
    SBLK = np.array([0.012, 0.012, 0.016]); SWHITE = np.array([0.8, 0.8, 0.82])
    # big white spider: front body at the chest pole, legs wrap along meridians to the back spider
    white = np.full(N, 1e9)
    zc2 = zc - 0.035
    chest2 = np.stack([x, z - zc2], 1)
    body_f = spider_sdf(chest2, scale=2.2, leg_w=0.0, body_scale=1.15)
    body_f = np.where(y > 0, body_f, 1e9)
    back2 = np.stack([-x, z - (zc - 0.02)], 1)
    body_b = spider_sdf(back2, scale=2.4, leg_w=0.0, body_scale=1.1)
    body_b = np.where(y < 0, body_b, 1e9)
    white = np.minimum(body_f, body_b)
    # legs as meridians of the torso sphere (lam: 0 = up, +-pi = down)
    v = P - Ct
    r = np.linalg.norm(v, axis=1)
    phi = phi_t; lam = lam_t
    for sgn in (-1, 1):
        for lam0, bend, w0 in ((0.62, 0.15, 0.018), (1.12, 0.2, 0.016), (2.0, -0.2, 0.016), (2.55, -0.14, 0.017)):
            # bend: the leg's "knee" kinks around phi ~ 1 rad
            lam_leg = sgn * (lam0 + bend * np.sin(np.clip(phi, 0, np.pi)))
            d = r * np.sin(np.clip(phi, 0.05, np.pi)) * np.abs(wrap(lam - lam_leg))
            wv = w0 * (0.55 + 0.45 * np.sin(np.clip(phi, 0, np.pi)))
            legd = d - wv
            legd = np.where((phi > 0.18) & (phi < np.pi - 0.18), legd, 1e9)
            white = np.minimum(white, legd)
    white = np.where(tmask | (part == 2), white, 1e9)
    wcov = 1 - sstep(-px * 0.5, px * 0.5, white)
    sbase = np.outer(1 - wcov, SBLK) + np.outer(wcov, SWHITE)
    sbase = sbase * shade[:, None]
    frameS = 1 - sstep(0.0028 - px * 0.5, 0.0028 + px * 0.5, lensB)
    lens_inS = 1 - sstep(-px * 0.5, px * 0.5, lensB)
    sbase = sbase * (1 - frameS[:, None]) + np.outer(frameS, SBLK * 0.5)
    sbase = sbase * (1 - lens_inS[:, None]) + np.outer(lens_inS, WHITE)
    rough_s = 0.26 + 0.2 * wcov
    rough_s = rough_s * (1 - lens_inS) + 0.12 * lens_inS

    return dict(classic=base, classic_rough=rough_c, symbiote=sbase, symbiote_rough=rough_s, height=height)
