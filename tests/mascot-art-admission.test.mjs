import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evaluateArtEvidence,sha256,gitBlobSha,REJECTED} from '../scripts/mascots/art-admission.mjs';

const origin=path.resolve('assets/mascots/concepts/minimal-flat-v5');
const sourceMaster={
  iskra:'masters/iskra-master.svg',
  szlif:'masters/szlif-master.svg'
};
const sizes=[512,64,32];
function withEvidence(run){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mascot-art-admission-'));
  const copy=(source,target)=>{
    const destination=path.join(tmp,target);
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.copyFileSync(path.join(origin,source),destination);
    return {path:target,sha256:sha256(fs.readFileSync(destination))};
  };
  try {
    const sources={};
    for(const [role,rel] of Object.entries(sourceMaster)){
      sources[role]=copy(rel,'source/'+role+'.svg');
    }
    const images={};
    for(const role of ['iskra','szlif','pair']){
      const prefix=role==='pair'?'iskra-szlif-vignette':role+'-master';
      for(const size of sizes)images[role+'_'+size]=copy('exports/'+prefix+'-'+size+'.png','images/'+role+'-'+size+'.png');
    }
    const directions={};
    for(const [letter,low] of [['A','a'],['B','b'],['C','c']]){
      directions[letter]={
        sourceSha256:sha256(Buffer.from('fixture-direction-'+letter)),
        pair512:copy('exports/iskra-'+low+'-szlif-'+low+'-pair-512.png','directions/'+letter+'.png')
      };
    }
    const evidence={
      candidate:{commit:'10f16de67f41f36f34c20333c9405fa8916c91a8',
        writerAgentId:'designer',visualReviewerAgentId:'cmo',sources},
      images,directions,
      optical:{
        iskra:{kind:'purpose_drawn_bust',sourceSha256:'a'.repeat(64)},
        szlif:{kind:'purpose_drawn_icon',sourceSha256:'b'.repeat(64)},
      },
      vision:{mock:false,inputType:'image_bytes',model:'fixture-model-not-real',
        invocationId:'fixture-invocation-not-real',screenshotSha256:images.pair_512.sha256,
        verdict:'provisionally_acceptable'}
    };
    return run({tmp,evidence,copy});
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
const codes=(result)=>result.errors.map(x=>x.code);

test('a technically plausible fixture is at most READY_FOR_OWNER_VISUAL_REVIEW, never artistic approval',()=>{
  withEvidence(({tmp,evidence})=>{
    const r=evaluateArtEvidence(evidence,{root:tmp,mode:'concept'});
    assert.equal(r.status,'READY_FOR_OWNER_VISUAL_REVIEW');
    assert.equal(r.errors.length,0);
    assert.notEqual(r.status,'ART_APPROVED');
    assert.notEqual(r.status,'RELEASE_PASS');
  });
});
test('owner-rejected V7 exact commit is BLOCKED even with fake all-green metrics',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.candidate.commit='15c1a642867b3239a2ce4553d0ab4d1a9e51770b';
    evidence.ownerVerdict='approved';evidence.tests='1000/1000 PASS';
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('OWNER_REJECTED_CANDIDATE'));
  });
});
test('owner-rejected V4 cannot be resurrected by old CMO approval',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.candidate.commit='2a09273490ebbe73fead95f09378057d67a903ec';
    evidence.cmoApproval=true;
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('OWNER_REJECTED_CANDIDATE'));
  });
});
test('V7 rejected master blob fingerprint is independent of later harmless Git commits',()=>{
  withEvidence(({tmp,evidence})=>{
    assert.equal(REJECTED.blobs.length,2);
    const src=fs.readFileSync(path.join(tmp,evidence.candidate.sources.iskra.path));
    assert.ok(gitBlobSha(src).match(/^[0-9a-f]{40}$/));
    const v7Sha=REJECTED.blobs[0];
    const bytes=fs.readFileSync(path.join(origin,'masters/iskra-master.svg'));
    assert.notEqual(gitBlobSha(bytes),v7Sha);
    // Owner rejection cannot be cleared by setting an ownerVerdict flag.
    evidence.candidate.commit=REJECTED.commits[0];
    evidence.ownerVerdict='approved';
    assert.equal(evaluateArtEvidence(evidence,{root:tmp}).status,'BLOCKED');
  });
});
test('uniformly scaled 32px is not accepted as purpose-drawn optical art',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.optical.iskra.kind='uniform_full_body_scale';
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('NO_PURPOSE_DRAWN_32PX'));
  });
});
test('all A/B/C pointing to the same image and source is rejected',()=>{
  withEvidence(({tmp,evidence})=>{
    for(const dir of ['B','C'])evidence.directions[dir]={...evidence.directions.A};
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('DIRECTIONS_NOT_DISTINCT'));
  });
});
test('fake VLM or text-only review cannot be promoted to visually inspected',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.vision.mock=true;
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('UNVERIFIED_REAL_IMAGE_CRITIQUE'));
    evidence.vision.mock=false;evidence.vision.inputType='text_only';
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('UNVERIFIED_REAL_IMAGE_CRITIQUE'));
  });
});
test('vision inputs must be bound to exactly the currently submitted real pixels',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.vision.screenshotSha256='a'.repeat(64);
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('UNVERIFIED_REAL_IMAGE_CRITIQUE'));
  });
});
test('independent reviewer must differ from producing agent',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.candidate.visualReviewerAgentId=evidence.candidate.writerAgentId;
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('SELF_REVIEW'));
  });
});
test('image bytes and declared hash must match, no filename-only proof',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.images.szlif_64.sha256='f'.repeat(64);
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('IMAGE_HASH_MISMATCH'));
  });
});
test('no file path traversal to unrelated sensitive files',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.images.iskra_512.path='../outside.png';
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('IMAGE_NOT_READABLE'));
  });
});
test('incomplete tiny proof is blocked even with 512px perfect',()=>{
  withEvidence(({tmp,evidence})=>{
    delete evidence.images.iskra_32;
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('IMAGE_EVIDENCE_MISSING'));
  });
});
test('unresolved genuine vision defects block owner review',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.vision.verdict='changes_requested';
    assert.ok(codes(evaluateArtEvidence(evidence,{root:tmp})).includes('VISUAL_CHANGES_REQUESTED'));
  });
});
test('offline evidence can NEVER declare first-class Paperclip owner/CMO/UI QA approval',()=>{
  withEvidence(({tmp,evidence})=>{
    evidence.ownerAccepted=true;evidence.cmoAccepted=true;evidence.technicalPass=true;
    const r=evaluateArtEvidence(evidence,{root:tmp,mode:'release'});
    assert.equal(r.status,'BLOCKED');
    assert.ok(codes(r).includes('NATIVE_ART_OWNER_UIQA_NOT_VERIFIED'));
  });
});
test('no evidence returns BLOCKED fail-closed',()=>{
  const r=evaluateArtEvidence(null);
  assert.equal(r.status,'BLOCKED');assert.ok(codes(r).includes('EVIDENCE_MISSING'));
});


test('EXACT rejected V7 fox/raven SVG blobs fail even after a later Git commit and green technical results',()=>{
  withEvidence(({tmp,evidence})=>{
    for(const [role,index] of [['iskra',0],['szlif',1]]){
      const rejected=fs.readFileSync(path.resolve('tests/fixtures/mascots-owner-rejected/v7-'+role+'-master.svg'));
      assert.equal(gitBlobSha(rejected),REJECTED.blobs[index],'real GitHub V7 source fixture');
      const dest=path.join(tmp,evidence.candidate.sources[role].path);
      fs.writeFileSync(dest,rejected);
      evidence.candidate.sources[role].sha256=sha256(rejected);
    }
    evidence.candidate.commit='c'.repeat(40); // hypothetical follow-up commit; source art unchanged
    evidence.technicalTestsPassed=true;
    evidence.ownerVerdict='approved'; // unverified agent claim cannot override actual rejection
    const result=evaluateArtEvidence(evidence,{root:tmp});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.errors.filter(x=>x.code==='OWNER_REJECTED_SOURCE_BLOB').length,2);
  });
});

