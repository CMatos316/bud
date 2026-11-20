// Little 3D models of the things found on Lighthouse Rock (js/away.js lists them), about half a unit across and
// sitting on y = 0. Used where they lie on the Rock (far.html) and on porches back home (world.html).
export function makeFind(THREE, kind) {
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const M = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.8, ...o });
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
  const ball = (r = 1, d = 10) => new THREE.SphereGeometry(r, d, Math.max(6, d - 2));
  switch (kind) {
    case 'feather': {
      const v = add(ball(0.2), M('#F4F1EA'), 0, 0.2, 0, 0.42, 1.25, 0.08); v.rotation.z = 0.5;
      const tip = add(ball(0.1), M('#8E96A8'), -0.11, 0.38, 0, 0.5, 1, 0.1); tip.rotation.z = 0.5;
      const q = add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), M('#D8D2C4'), 0.02, 0.2, 0); q.rotation.z = 0.5;
      break;
    }
    case 'clover': {
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.24, 5), M('#4E9A57'), 0, 0.12, 0);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; add(ball(0.09), M('#5DB868'), Math.cos(a) * 0.09, 0.25, Math.sin(a) * 0.09, 1, 0.3, 1); }
      break;
    }
    case 'pinecone': {
      const c = M('#8A5A3A', { flatShading: true });
      for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.17 - i * 0.03, 0.16, 7), c, 0, 0.09 + i * 0.09, 0);
      break;
    }
    case 'mushroom': {
      add(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 8), M('#F4EBDD'), 0, 0.11, 0);
      add(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M('#E0473A', { roughness: 0.5 }), 0, 0.2, 0, 1, 0.8, 1);
      for (const [x, y, z] of [[0.09, 0.3, 0.06], [-0.08, 0.31, 0.02], [0, 0.34, -0.07], [0.02, 0.27, 0.15]]) add(ball(0.028, 6), M('#FFFFFF'), x, y, z);
      break;
    }
    case 'acorn': {
      add(ball(0.13), M('#C99A5B', { roughness: 0.5 }), 0, 0.14, 0, 0.9, 1.15, 0.9);
      add(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M('#7A5233'), 0, 0.2, 0, 1, 0.75, 1);
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 5), M('#7A5233'), 0, 0.33, 0);
      break;
    }
    case 'shell': {
      const c = M('#F2C9B8', { roughness: 0.45 });
      add(ball(0.17), c, 0, 0.16, 0, 1, 0.95, 0.8); add(ball(0.11), c, 0.1, 0.24, 0, 1, 1, 0.8); add(ball(0.06), M('#E79C86', { roughness: 0.45 }), 0.17, 0.3, 0, 1, 1, 0.8);
      add(ball(0.08), M('#6B4A3E'), -0.1, 0.1, 0.07, 1, 1, 0.6);
      break;
    }
    case 'glass': {
      const m = add(new THREE.IcosahedronGeometry(0.17, 0), M('#7FD8CF', { roughness: 0.15, transparent: true, opacity: 0.78, flatShading: true }), 0, 0.1, 0, 1.2, 0.5, 0.9); m.rotation.y = 0.6;
      break;
    }
    case 'driftwood': {
      const c = M('#B9A996'), a = add(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 7), c, 0, 0.07, 0); a.rotation.z = Math.PI / 2 - 0.08;
      const b = add(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 6), c, 0.1, 0.15, 0.03); b.rotation.z = -0.7;
      break;
    }
    case 'pebble': {
      add(ball(0.18), M('#8C93A3', { roughness: 0.55 }), 0, 0.09, 0, 1.15, 0.55, 0.9);
      for (const z of [-0.05, 0.06]) { const t = add(new THREE.TorusGeometry(0.16, 0.014, 5, 20), M('#F1EEE6'), 0, 0.1, z, 1.12, 0.58, 1); t.rotation.y = Math.PI / 2; t.scale.set(0.9 - Math.abs(z) * 2, 0.56, 1.1); }
      break;
    }
    case 'fossil': {
      add(new THREE.CylinderGeometry(0.22, 0.25, 0.09, 9), M('#A39C90', { flatShading: true }), 0, 0.05, 0);
      for (let i = 0; i < 3; i++) { const t = add(new THREE.TorusGeometry(0.15 - i * 0.05, 0.02, 5, 16), M('#EDE6D6'), i * 0.02, 0.1, 0); t.rotation.x = Math.PI / 2; }
      break;
    }
    case 'float': {
      add(ball(0.2, 14), M('#5EC2D6', { roughness: 0.1, transparent: true, opacity: 0.72 }), 0, 0.2, 0);
      for (const r of [0, Math.PI / 2]) { const t = add(new THREE.TorusGeometry(0.205, 0.012, 5, 20), M('#C9B48A'), 0, 0.2, 0); t.rotation.y = r; }
      const e = add(new THREE.TorusGeometry(0.205, 0.012, 5, 20), M('#C9B48A'), 0, 0.2, 0); e.rotation.x = Math.PI / 2;
      break;
    }
    case 'star': {
      const c = new THREE.MeshStandardMaterial({ color: lin('#FFE27A'), emissive: lin('#FFC83A'), emissiveIntensity: 0.9, roughness: 0.4, flatShading: true });
      const a = add(new THREE.OctahedronGeometry(0.2, 0), c, 0, 0.22, 0, 1, 1, 0.55), b = add(new THREE.OctahedronGeometry(0.2, 0), c, 0, 0.22, 0, 1, 1, 0.55); b.rotation.z = Math.PI / 4; a.userData.glow = b.userData.glow = true;
      break;
    }
    case 'lantern': {
      const iron = M('#3A3F4F', { roughness: 0.6 });
      add(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 8), iron, 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8), new THREE.MeshStandardMaterial({ color: lin('#FFE9A8'), emissive: lin('#FFB94A'), emissiveIntensity: 1.1, roughness: 0.3 }), 0, 0.16, 0).userData.glow = true;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; add(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4), iron, Math.cos(a) * 0.11, 0.16, Math.sin(a) * 0.11); }
      add(new THREE.ConeGeometry(0.15, 0.1, 8), iron, 0, 0.33, 0);
      const h = add(new THREE.TorusGeometry(0.07, 0.012, 5, 14), iron, 0, 0.42, 0); h.userData.handle = true;
      break;
    }
    default: add(ball(0.15), M('#CCCCCC'), 0, 0.15, 0);
  }
  return g;
}
