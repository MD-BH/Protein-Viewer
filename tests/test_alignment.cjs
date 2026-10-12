// Run with Node; no packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const alignment = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../viewer_src/alignment.js'), 'utf8') + '\nProteinAlignment', {setTimeout});
(async () => {
  const reference = [{x:1,y:2,z:3},{x:5,y:2,z:1},{x:1,y:7,z:2},{x:2,y:1,z:9}];
  const moved = reference.map(p => ({x:-p.y+30,y:p.x-40,z:p.z+15}));
  const original = JSON.stringify(moved);
  const result = await alignment.fit(reference.map((p,i)=>[p,moved[i]]));
  assert(result.rmsd < 1e-10, result.rmsd);
  assert.equal(JSON.stringify(moved), original);
  for (let i=0;i<reference.length;i++) {
    const p=result.transform(moved[i]);
    for (const k of ['x','y','z']) assert(Math.abs(p[k]-reference[i][k])<1e-10);
  }
  const r=result.rotation;
  const det=r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
  assert(Math.abs(det-1)<1e-10);
  const reflection = await alignment.fit(reference.map(p=>[p,{...p,x:-p.x}]));
  assert(reflection.rmsd > 0.1, 'A reflection must not be accepted as a proper rotation');
  const planar=await alignment.fit(reference.slice(0,3).map((p,i)=>[p,moved[i]]));
  assert(planar.rmsd<1e-10);
  await assert.rejects(alignment.fit([[reference[0],moved[0]]]), /three/);
  await assert.rejects(alignment.fit([0,1,2].map(x=>[{x,y:0,z:0},{x,y:1,z:0}])), /collinear/);
  const residues = (sequence, offset=0) => [...sequence].map((resname1,i)=>({resname1,resseq:i+offset,ca:{x:i,y:i*i,z:Math.sin(i)}}));
  const a=residues('ACDEFGHIK');
  const b=residues('ACDFGHIK',100);
  b[4].resname1='A'; // substitution is still a fitted correspondence
  b[6].ca=null; // no fallback atom is allowed
  const match=await alignment.matchResidues(a,b);
  assert.equal(match.pairs.length,7);
  assert.equal(match.identity,7/8);
  assert.equal(match.referenceCoverage,7/9);
  assert.equal(match.comparisonCoverage,7/8);
  assert.equal(match.pairs[3][0].x,4); // deletion aligned, independent of numbering
  let ticks=0;
  await alignment.matchResidues(residues('A'.repeat(100)),residues('A'.repeat(100)),()=>ticks++);
  assert(ticks>5);
  await assert.rejects(alignment.matchResidues(a,b,()=>{throw Error('stale');}), /stale/);
  console.log('PASS: rigid fit, proper rotation, planar fit, degeneracy, sequence gaps/substitutions, missing CA, renumbering, yielding and cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
