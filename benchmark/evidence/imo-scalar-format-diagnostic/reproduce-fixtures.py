"""Private data custodian; no inference, no score exposure in stdout."""
import csv,hashlib,json,os,unicodedata
from collections import Counter
from pathlib import Path

import argparse
from urllib.request import urlopen
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--out',required=True,type=Path)
p.add_argument('--source-file',type=Path,help='Optional local copy of the original pinned CSV.')
args=p.parse_args()
BASE=args.out;BASE.mkdir(parents=True,exist_ok=True);(BASE/'blind').mkdir(exist_ok=True);(BASE/'custodian').mkdir(mode=0o700,exist_ok=True)
protocol_file=Path(__file__).resolve().with_name('protocol.json')
config=json.loads(protocol_file.read_text())
def sha(value):return hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def norm(s):return ' '.join(unicodedata.normalize('NFC',s).split())
def save(path,value):
    data=(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
    if path.exists() and data!=path.read_bytes():raise ValueError('Refusing to replace frozen '+path.name)
    path.write_bytes(data);return sha(data)

source_url='https://raw.githubusercontent.com/google-deepmind/superhuman/9b620a92886b3a7655b30ddcfe36e725e9596509/imobench/gradingbench.csv'
if args.source_file:
    blob=args.source_file.read_bytes()
else:
    with urlopen(source_url,timeout=60) as response:blob=response.read(11111437)
if len(blob)!=11111436 or sha(blob)!=config['sourceSha256']:raise ValueError('Pinned source changed')
import io
rows=list(csv.DictReader(io.StringIO(blob.decode('utf-8'),newline='')))
# The original no-inference smoke used the first 24 cases sorted by this deterministic ID hash.
smoke=sorted(rows,key=lambda r:sha('noether-v1:imo-'+r['Grading ID']))[:24]
smoke_ids={r['Grading ID']for r in smoke};smoke_problem_ids={r['Problem ID']for r in smoke}
# The earlier 19-case selection was confined to the six novel problem IDs absent from that smoke roster.
old_problem_ids={r['Problem ID']for r in rows if r['Problem Source']=='Novel Problem' and r['Problem ID'] not in smoke_problem_ids}
if len(old_problem_ids)!=6:raise ValueError('Original source-novel roster changed')
statements={norm(r['Problem'])for r in rows if r['Problem ID']in old_problem_ids}
# Duplicate response text anywhere in the source is rejected below, so a response from one of those
# six excluded questions cannot re-enter under a different retained question.
answers=set()
repeats=Counter(norm(r['Response']) for r in rows)
scoped=[r for r in rows if r['Problem Source']=='Novel Problem' and norm(r['Problem']) not in statements]

def fixture(r):
    q={'id':'p-'+sha(config['problemSalt']+r['Problem ID'])[:16],'statement':r['Problem'],'maxMarks':7,
       'rubric':[{'id':'proof','description':'Assess the entire argument on the 0–7 scale. Accept valid alternative proofs. Apply the common problem-specific grading guidance: '+r['Grading guidelines'],'points':7}],'solution':r['Solution']}
    return {'id':'r-'+sha(config['caseSalt']+r['Grading ID'])[:16],'category':'blind-proof-study','question':q,'answer':r['Response']}
def eligible(r):
    if r['Grading ID'] in smoke_ids or norm(r['Response']) in answers or repeats[norm(r['Response'])]!=1:return False
    f=fixture(r);q=f['question'];a=f['answer'];
    return (0<len(q['statement'].strip())<=15000 and len(q['solution'])<=15000 and len(q['rubric'][0]['description'])<=2000
            and 0<len(a.strip())<=20000 and len(json.dumps({'question':q,'answer':a},ensure_ascii=False).encode())<=65000)
pool=list(filter(eligible,scoped));order=lambda r:(sha(config['selectionSalt']+r['Grading ID']),r['Grading ID'])
buckets={band:sorted([r for r in pool if int(r['Points']) in scores],key=order)for band,scores in config['bands'].items()}
def select(index,problems):
    if index==len(config['slotOrder']):return []
    for row in buckets[config['slotOrder'][index]]:
        if row['Problem ID'] in problems:continue
        tail=select(index+1,problems|{row['Problem ID']})
        if tail is not None:return [row,*tail]
    return None
chosen=select(0,set());assert chosen is not None
chosen.sort(key=lambda r:sha(config['presentationSalt']+r['Grading ID']))
fixtures=[fixture(r)for r in chosen];assert len({r['question']['id'] for r in fixtures})==6
assert not ({norm(f['question']['statement']) for f in fixtures}&statements);assert len({norm(f['answer']) for f in fixtures})==6
fxsha=save(BASE/'blind/fixtures.json',fixtures)
target=[{'id':f['id'],'problem':f['question']['id'],'score':int(r['Points']),'maxMarks':7,'source':'human','originalGradingId':r['Grading ID'],'originalProblemId':r['Problem ID'],'labelProvenance':'Published human research grade for an internal model-written IMO-GradingBench proof; not an official contestant mark.'}for f,r in zip(fixtures,chosen)]
targetsha=save(BASE/'custodian/sealed-targets.json',target);os.chmod(BASE/'custodian/sealed-targets.json',0o600)
manifest={'version':config['version'],'sourceSha256':config['sourceSha256'],'protocolSha256':sha(protocol_file.read_bytes()),
    'sourceRows':len(rows),'sourceProblems':len({r['Problem ID']for r in rows}),'availableDistinctNovelProblems':len({r['Problem ID']for r in scoped}),
    'eligibleResponses':len(pool),'eligiblePartialResponses':sum(len(v) for v in buckets.values()),'priorFrozenCasesExcluded':19,'previousOfflineSmokeIdsExcluded':len(smoke_ids),
    'problemOverlapWithPriorNineteen':0,'responseOverlapWithPriorNineteen':0,'caseCount':6,'distinctProblems':6,'partialCount':6,
    'caseIdsInBlindOrder':[f['id']for f in fixtures],'fixtureSha256':fxsha,'sealedTargetsSha256':targetsha}
save(BASE/'manifest.json',manifest);print(json.dumps({k:v for k,v in manifest.items()if k!='caseIdsInBlindOrder'},indent=2))
