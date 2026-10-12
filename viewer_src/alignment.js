/* Sequence correspondence and proper rigid fitting, independent of the viewer. */
const ProteinAlignment = (() => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));

  async function matchResidues(reference, comparison, check = () => {}) {
    const n = reference.length, m = comparison.length;
    if (!n || !m) throw new Error('Both selected chains must contain residues.');
    // Bound the traceback allocation, rather than exhausting the browser tab.
    if ((n + 1) * (m + 1) > 50000000) throw new Error('Selected chains are too long for browser sequence alignment.');
    const directions = new Uint8Array((n + 1) * (m + 1));
    let previous = Int32Array.from({ length: m + 1 }, (_, j) => -2 * j);
    let current = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      if (i % 16 === 1) { await pause(); check(); }
      current[0] = -2 * i;
      for (let j = 1; j <= m; j++) {
        const diagonal = previous[j - 1] + (reference[i - 1].resname1 === comparison[j - 1].resname1 ? 2 : -1);
        const up = previous[j] - 2, left = current[j - 1] - 2;
        const best = Math.max(diagonal, up, left);
        current[j] = best;
        directions[i * (m + 1) + j] = best === diagonal ? 0 : best === up ? 1 : 2;
      }
      [previous, current] = [current, previous];
    }
    const pairs = [];
    let i = n, j = m, aligned = 0, identical = 0;
    while (i || j) {
      if (!j || (i && directions[i * (m + 1) + j] === 1)) { i--; continue; }
      if (!i || directions[i * (m + 1) + j] === 2) { j--; continue; }
      const a = reference[--i], b = comparison[--j];
      aligned++;
      if (a.resname1 !== 'X' && a.resname1 === b.resname1) identical++;
      if (a.ca && b.ca) pairs.push([a.ca, b.ca]);
    }
    check();
    return { pairs: pairs.reverse(), identity: aligned ? identical / aligned : 0,
      referenceCoverage: pairs.length / n, comparisonCoverage: pairs.length / m };
  }

  function nonCollinear(points) {
    const origin = points[0];
    let axis, maxLength = 0;
    for (const p of points) {
      const v = [p.x - origin.x, p.y - origin.y, p.z - origin.z];
      const length = v.reduce((s, x) => s + x * x, 0);
      if (length > maxLength) { maxLength = length; axis = v; }
    }
    if (maxLength < 1e-16) return false;
    return points.some(p => {
      const v = [p.x - origin.x, p.y - origin.y, p.z - origin.z];
      const cross = [axis[1]*v[2]-axis[2]*v[1], axis[2]*v[0]-axis[0]*v[2], axis[0]*v[1]-axis[1]*v[0]];
      return cross.reduce((s, x) => s + x*x, 0) > maxLength * maxLength * 1e-12;
    });
  }

  async function fit(pairs, check = () => {}) {
    if (pairs.length < 3 || !pairs.every(pair => pair.every(p => [p.x,p.y,p.z].every(Number.isFinite))))
      throw new Error('Alignment needs at least three valid Cα pairs.');
    const ref = pairs.map(p => p[0]), moving = pairs.map(p => p[1]);
    if (!nonCollinear(ref) || !nonCollinear(moving)) throw new Error('Cα pairs are collinear; rotation cannot be determined.');
    const center = points => ['x','y','z'].map(k => points.reduce((s,p) => s+p[k],0)/points.length);
    const a = center(ref), b = center(moving);
    const s = Array.from({length:3}, () => [0,0,0]);
    for (let k = 0; k < pairs.length; k++) {
      if (k % 2048 === 0) { await pause(); check(); }
      const x = [moving[k].x-b[0], moving[k].y-b[1], moving[k].z-b[2]];
      const y = [ref[k].x-a[0], ref[k].y-a[1], ref[k].z-a[2]];
      for (let i=0;i<3;i++) for (let j=0;j<3;j++) s[i][j] += x[i]*y[j];
    }
    // Horn's symmetric quaternion matrix. Its largest eigenvector gives a
    // proper rotation (determinant +1), including for planar coordinate sets.
    const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]] = s;
    const matrix = [
      [xx+yy+zz, yz-zy, zx-xz, xy-yx],
      [yz-zy, xx-yy-zz, xy+yx, zx+xz],
      [zx-xz, xy+yx, -xx+yy-zz, yz+zy],
      [xy-yx, zx+xz, yz+zy, -xx-yy+zz]
    ];
    const vectors = Array.from({length:4}, (_,i) => Array.from({length:4}, (_,j) => Number(i===j)));
    const scale = Math.max(...matrix.flat().map(Math.abs), 1);
    for (let iteration=0;iteration<100;iteration++) {
      let p=0,q=1;
      for (let i=0;i<4;i++) for (let j=i+1;j<4;j++) if (Math.abs(matrix[i][j])>Math.abs(matrix[p][q])) {p=i;q=j;}
      if (Math.abs(matrix[p][q]) < scale*1e-14) break;
      const angle = 0.5*Math.atan2(2*matrix[p][q], matrix[q][q]-matrix[p][p]);
      const c=Math.cos(angle), t=Math.sin(angle), pp=matrix[p][p], qq=matrix[q][q], pq=matrix[p][q];
      for (let k=0;k<4;k++) {
        if (k!==p && k!==q) {
          const kp=matrix[k][p], kq=matrix[k][q];
          matrix[k][p]=matrix[p][k]=c*kp-t*kq;
          matrix[k][q]=matrix[q][k]=t*kp+c*kq;
        }
        const vp=vectors[k][p], vq=vectors[k][q];
        vectors[k][p]=c*vp-t*vq; vectors[k][q]=t*vp+c*vq;
      }
      matrix[p][p]=c*c*pp-2*c*t*pq+t*t*qq;
      matrix[q][q]=t*t*pp+2*c*t*pq+c*c*qq;
      matrix[p][q]=matrix[q][p]=0;
    }
    let largest=0;
    for (let i=1;i<4;i++) if (matrix[i][i]>matrix[largest][largest]) largest=i;
    const [w,x,y,z]=vectors.map(row=>row[largest]);
    const rotation=[
      [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
      [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]
    ];
    const transform = p => {
      const v=[p.x-b[0],p.y-b[1],p.z-b[2]];
      const result=rotation.map((row,i)=>row.reduce((sum,value,j)=>sum+value*v[j],a[i]));
      return {x:result[0],y:result[1],z:result[2]};
    };
    let sum=0;
    for (let i=0;i<pairs.length;i++) {
      const p=transform(moving[i]);
      sum+=(p.x-ref[i].x)**2+(p.y-ref[i].y)**2+(p.z-ref[i].z)**2;
    }
    check();
    return { transform, rotation, rmsd: Math.sqrt(sum/pairs.length) };
  }
  return { matchResidues, fit };
})();
